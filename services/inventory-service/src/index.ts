import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import client from 'prom-client';

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

// Prometheus Metrics
const register = new client.Registry();
client.collectDefaultMetrics({ register });
app.get('/metrics', async (req, res) => {
    res.setHeader('Content-Type', register.contentType);
    res.send(await register.metrics());
});

// Health Check
app.get('/health', async (req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.status(200).json({ status: 'UP', db: 'CONNECTED' });
    } catch (error) {
        res.status(503).json({ status: 'DOWN', db: 'DISCONNECTED' });
    }
});

// Seed Products (Internal function)
const seedProducts = async () => {
    try {
        const count = await prisma.product.count();
        if (count === 0) {
            console.log("Seeding products...");
            await prisma.product.createMany({
                data: [
                    { name: 'Quantum Processor', stock: 100 },
                    { name: 'Neural Interface', stock: 50 },
                    { name: 'Flux Capacitor', stock: 20 },
                    { name: 'Hyperdrive Unit', stock: 10 }
                ]
            });
            console.log("Seeding complete.");
        }
    } catch (e) {
        console.error("Seeding failed:", e);
    }
};

// Seed Endpoint (Manual trigger if needed)
app.post('/seed', async (req, res) => {
    await seedProducts();
    res.json({ message: 'Seeding check complete' });
});

// Get all products
app.get('/products', async (req, res) => {
    const products = await prisma.product.findMany({ orderBy: { name: 'asc' } });
    res.json(products);
});

// Deduct Inventory (with Idempotency + Gremlin Latency)
app.post('/inventory/deduct', async (req: Request, res: Response) => {
    const { productId, quantity, orderId } = req.body;

    if (!productId || !quantity || !orderId) {
        res.status(400).json({ error: 'Missing productId, quantity, or orderId' });
        return;
    }

    try {
        // 1. Check Idempotency
        const existingLog = await prisma.idempotencyLog.findUnique({
            where: { orderId }
        });

        if (existingLog) {
            console.log(`Idempotency check: Order ${orderId} already processed.`);
            // Return previous success immediately (skip Gremlin this time?)
            // If we want to simulate "Vanishing Response" persisting, we might sleep again, 
            // but to solve the issue, we usually return success fast on retry.
            res.status(200).json({ message: 'Stock already deducted (Idempotent)', success: true });
            return;
        }

        // 2. Transaction: Deduct Stock + Log Idempotency
        await prisma.$transaction(async (tx) => {
            const product = await tx.product.findUnique({ where: { id: productId } });
            if (!product || product.stock < quantity) {
                throw new Error('Insufficient stock or product not found');
            }

            await tx.product.update({
                where: { id: productId },
                data: { stock: product.stock - quantity }
            });

            await tx.idempotencyLog.create({
                data: { orderId }
            });
        });

        // 3. Gremlin Latency (The Vanishing Response)
        // Deterministic delay: response delays by 5 seconds if orderId ends with 'DELAY' or basically always to force timeout demonstration.
        // The requirement says "deterministic pattern". Let's say if quantity is > 5, or just always for now to verify observability.
        // Let's make it deterministic based on orderId hash/char.
        // If orderId starts with 'GREMLIN', we delay.
        // Or simpler: Just delay 3s (Order timeout is 2s).
        // But then *all* orders fail.
        // Let's only delay if the 'quantity' is 13 (unlucky number).

        if (quantity === 13) {
            console.log("Gremlin Triggered: Delaying response...");
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        res.status(200).json({ message: 'Stock deducted', success: true });

    } catch (error: any) {
        console.error("Inventory Error:", error.message);
        res.status(400).json({ error: error.message });
    }
});

app.listen(PORT, async () => {
    console.log(`Inventory Service running on port ${PORT}`);
    await seedProducts();
});
