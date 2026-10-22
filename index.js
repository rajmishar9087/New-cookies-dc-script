const express = require('express');
const multer = require('multer'); // ✅ फाइल अपलोड के लिए जरूरी
const { Client } = require('meta-messenger.js');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ✅ फाइल को मेमोरी में स्टोर करें (डिस्क पर नहीं)
const upload = multer({ storage: multer.memoryStorage() });

const tasks = new Map();
const MAX_LOGS = 50;

const HTML_PAGE = `...`; // (आपका HTML पेज पहले जैसा ही रहेगा, इसे यहाँ पेस्ट करें)

app.get('/', (req, res) => res.send(HTML_PAGE));

// ✅ multer मिडलवेयर जोड़ें (upload.single)
app.post('/start', upload.single('message_file'), async (req, res) => {
    try {
        const { cookies: cookieInput, thread_id, hater_name, delay } = req.body;

        if (!cookieInput) return res.status(400).json({ error: "Cookie string खाली है।" });
        if (!req.file) return res.status(400).json({ error: "Message file जरूरी है!" }); // ✅ req.file (singular)

        // ✅ रॉ कुकी स्ट्रिंग को मैन्युअली पार्स करें (Utils.parseCookies की जरूरत नहीं)
        const cookies = {};
        cookieInput.split(';').forEach(pair => {
            const [key, ...valueParts] = pair.trim().split('=');
            if (key && valueParts.length > 0) {
                cookies[key.trim()] = valueParts.join('=').trim();
            }
        });

        // ✅ सिर्फ जरूरी कुकीज़ की जाँच करें (fr की जरूरत नहीं)
        if (!cookies.c_user || !cookies.xs) {
            return res.status(400).json({ error: "कुकीज़ में c_user और xs होना अनिवार्य है।" });
        }

        const messages = req.file.buffer.toString('utf-8').split('\n').map(m => m.trim()).filter(m => m);
        if (messages.length === 0) return res.status(400).json({ error: "फाइल खाली है!" });

        const delayMs = parseFloat(delay) * 1000;

        // ✅ platform: 'facebook' (डिफ़ॉल्ट और टेस्टेड)
        const client = new Client(cookies, { platform: 'facebook' });

        const taskId = Math.random().toString(36).substring(2, 10);
        tasks.set(taskId, { status: 'running', logs: [], client: client });

        const logMsg = (msg) => {
            const task = tasks.get(taskId);
            if (task) {
                if (task.logs.length >= MAX_LOGS) task.logs.shift();
                task.logs.push(msg);
            }
        };

        logMsg(`🚀 Task initialized: ${taskId}`);

        (async () => {
            try {
                logMsg("🔄 Logging in via cookies...");
                const { user } = await client.connect();
                logMsg(`✅ Login Successful! Logged in as: ${user.name}`);

                let msgIndex = 0;
                while (tasks.get(taskId)?.status === 'running') {
                    const currentMessage = messages[msgIndex];
                    const formattedMsg = `${hater_name} ${currentMessage}`;

                    try {
                        // ✅ threadId को BigInt में बदलें
                        await client.sendMessage(BigInt(thread_id), formattedMsg);
                        logMsg(`📤 Sent: ${formattedMsg}`);
                    } catch (sendErr) {
                        logMsg(`⚠️ Send Error: ${sendErr.message}`);
                    }

                    msgIndex = (msgIndex + 1) % messages.length;
                    await new Promise(r => setTimeout(r, delayMs));
                }
                logMsg("🛑 Task stopped.");
            } catch (err) {
                logMsg(`❌ Login Error: ${err.message}`);
                const task = tasks.get(taskId);
                if (task) task.status = 'stopped';
            } finally {
                // ✅ टास्क खत्म होने पर क्लाइंट डिस्कनेक्ट करें (मेमोरी लीक रोकें)
                await client.disconnect().catch(() => {});
            }
        })();

        res.json({ success: true, task_id: taskId });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/stream/:task_id', (req, res) => {
    const taskId = req.params.task_id;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let lastLen = 0;
    const interval = setInterval(() => {
        const task = tasks.get(taskId);
        if (!task) {
            clearInterval(interval);
            res.end();
            return;
        }

        // ✅ लॉग शिफ्ट होने पर भी सही तरीके से भेजें
        if (task.logs.length > lastLen) {
            for (let i = lastLen; i < task.logs.length; i++) {
                res.write(`data: ${task.logs[i]}\n\n`);
            }
            lastLen = task.logs.length;
        }

        if (task.status === 'stopped' && lastLen >= task.logs.length) {
            res.write(`data: [TASK STOPPED]\n\n`);
            clearInterval(interval);
            res.end();
            tasks.delete(taskId); // 🧹 मेमोरी क्लीनअप
        }
    }, 500);

    req.on('close', () => clearInterval(interval));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {});
