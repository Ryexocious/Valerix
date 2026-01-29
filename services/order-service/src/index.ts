import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import cors from 'cors';
import client from 'prom-client';

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;
const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL || 'http://localhost:3002';

app.use(cors());
app.use(express.json());

// Prometheus Metrics
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestDurationMicroseconds = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'code'],
    buckets: [0.1, 0.5, 1, 1.5, 2, 5]
});
register.registerMetric(httpRequestDurationMicroseconds);

app.use((req, res, next) => {
    const end = httpRequestDurationMicroseconds.startTimer();
    res.on('finish', () => {
        end({ method: req.method, route: req.path, code: res.statusCode });
    });
    next();
});

// Health Check
app.get('/health', async (req: Request, res: Response) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.status(200).json({ status: 'UP', db: 'CONNECTED' });
    } catch (error) {
        res.status(503).json({ status: 'DOWN', db: 'DISCONNECTED' });
    }
});

// Metrics Endpoint
app.get('/metrics', async (req: Request, res: Response) => {
    res.setHeader('Content-Type', register.contentType);
    res.send(await register.metrics());
});

// Get all orders
app.get('/orders', async (req: Request, res: Response) => {
    const orders = await prisma.order.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(orders);
});

// Create Order (with Timeout handling)
app.post('/orders', async (req: Request, res: Response) => {
    const { productId, quantity } = req.body;

    if (!productId || !quantity) {
        res.status(400).json({ error: 'Missing productId or quantity' });
        return;
    }

    // 1. Create Order (PENDING)
    const order = await prisma.order.create({
        data: {
            productId,
            quantity,
            status: 'PENDING'
        }
    });

    try {
        // 2. Call Inventory Service with Timeout
        // Requirement: return clear timeout error instead of freezing.
        // We set timeout to 2000ms (2s). If Inventory takes longer (Gremlin), we fail.
        const inventoryResponse = await axios.post(`${INVENTORY_SERVICE_URL}/inventory/deduct`, {
            productId,
            quantity,
            orderId: order.id // For Idempotency
        }, {
            timeout: 2000
        });

        if (inventoryResponse.status === 200) {
            // 3. Update Order to CONFIRMED
            const updatedOrder = await prisma.order.update({
                where: { id: order.id },
                data: { status: 'CONFIRMED' }
            });
            res.status(201).json(updatedOrder);
        } else {
            throw new Error('Inventory deduction failed');
        }

    } catch (error: any) {
        console.error("Inventory call failed:", error.message);

        let errorMessage = 'Order failed due to inventory issue';
        if (error.code === 'ECONNABORTED') {
            errorMessage = 'Order processing timed out waiting for inventory';
        }

        // Update to FAILED
        await prisma.order.update({
            where: { id: order.id },
            data: { status: 'FAILED' }
        });

        res.status(503).json({ error: errorMessage, orderId: order.id, status: 'FAILED' });
    }
});

app.listen(PORT, () => {
    console.log(`Order Service running on port ${PORT}`);
});
