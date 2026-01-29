import { useState, useEffect } from 'react'
import axios from 'axios'
import './index.css'

const ORDER_SERVICE_URL = import.meta.env.VITE_ORDER_SERVICE_URL || 'http://localhost:3001';
const INVENTORY_SERVICE_URL = import.meta.env.VITE_INVENTORY_SERVICE_URL || 'http://localhost:3002';

interface Product {
    id: string;
    name: string;
    stock: number;
}

function App() {
    const [loading, setLoading] = useState(false);
    const [products, setProducts] = useState<Product[]>([]);
    const [selectedProduct, setSelectedProduct] = useState<string>('');
    const [logs, setLogs] = useState<string[]>([]);
    const [latency, setLatency] = useState<number | null>(null);
    const [health, setHealth] = useState<{ order: string }>({ order: 'CHECKING' });

    const addLog = (msg: string) => setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);

    const checkHealth = async () => {
        try {
            await axios.get(`${ORDER_SERVICE_URL}/health`);
            setHealth({ order: 'UP' });
        } catch (e) {
            setHealth({ order: 'DOWN' });
        }
    };

    const fetchProducts = async () => {
        try {
            const res = await axios.get(`${INVENTORY_SERVICE_URL}/products`);
            setProducts(res.data);
            if (res.data.length > 0 && !selectedProduct) {
                setSelectedProduct(res.data[0].id);
            }
        } catch (e) {
            addLog(`⚠️ Failed to fetch products: ${e}`);
        }
    };

    useEffect(() => {
        checkHealth();
        fetchProducts();
        const interval = setInterval(() => {
            checkHealth();
            fetchProducts(); // Refresh stock levels
        }, 5000);
        return () => clearInterval(interval);
    }, []);

    const placeOrder = async (isGremlin: boolean) => {
        if (!selectedProduct) {
            addLog("⚠️ No product selected!");
            return;
        }

        setLoading(true);
        const start = performance.now();
        addLog(`Initiating Order... (Product: ${products.find(p => p.id === selectedProduct)?.name}, Gremlin: ${isGremlin ? 'ON' : 'OFF'})`);

        try {
            // Use quantity=13 to trigger Gremlin Latency in Inventory Service
            const quantity = isGremlin ? 3 : 1;
            const response = await axios.post(`${ORDER_SERVICE_URL}/orders`, {
                productId: selectedProduct,
                quantity
            });

            const end = performance.now();
            const dur = Math.round(end - start);
            setLatency(dur);
            addLog(`✅ Order Success! ID: ${response.data.id}. Duration: ${dur}ms`);
            fetchProducts(); // Update stock immediately

        } catch (error: any) {
            const end = performance.now();
            const dur = Math.round(end - start);
            setLatency(dur);

            const errMsg = error.response?.data?.error || error.message;
            addLog(`❌ Order Failed: ${errMsg}. Duration: ${dur}ms`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <h1>Valerix Resilient Platform</h1>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginBottom: '2rem' }}>
                <div className={`status-badge ${health.order === 'UP' ? 'CONFIRMED' : 'FAILED'}`}>
                    Order Service: {health.order}
                </div>
            </div>

            <div className="card">
                <h2>Order Simulation</h2>
                <p style={{ color: '#8b949e', marginBottom: '1.5rem' }}>
                    Select a product and test resilience patterns.
                </p>

                <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>Select Product:</label>
                    <select
                        style={{
                            padding: '10px',
                            borderRadius: '5px',
                            backgroundColor: '#0d1117',
                            color: 'white',
                            border: '1px solid #30363d',
                            fontSize: '1rem',
                            minWidth: '200px'
                        }}
                        value={selectedProduct}
                        onChange={(e) => setSelectedProduct(e.target.value)}
                    >
                        {products.map(p => (
                            <option key={p.id} value={p.id}>
                                {p.name} (Stock: {p.stock})
                            </option>
                        ))}
                    </select>
                </div>

                <div style={{
                    fontSize: '2rem',
                    fontWeight: 'bold',
                    marginBottom: '1rem',
                    color: latency !== null ? (latency > 1500 ? 'var(--danger)' : 'var(--success)') : 'inherit'
                }}>
                    {latency !== null ? `${latency}ms` : '---'}
                    <div style={{ fontSize: '0.8rem', color: '#8b949e', fontWeight: 'normal' }}>Last Request Latency</div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button onClick={() => placeOrder(false)} disabled={loading || !selectedProduct}>
                        🚀 Place Normal Order
                    </button>
                    <button className="danger" onClick={() => placeOrder(true)} disabled={loading || !selectedProduct}>
                        🐢 Trigger Gremlin (Latency)
                    </button>
                </div>
            </div>

            <div className="log-container">
                <h3>System Logs</h3>
                {logs.map((log, i) => <div key={i} style={{ borderBottom: '1px solid #333', padding: '4px 0' }}>{log}</div>)}
            </div>
        </>
    )
}

export default App
