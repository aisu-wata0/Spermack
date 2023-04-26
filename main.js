const http = require('http');

const { readBody, splitJsonArray, wait } = require('./utils');
const { waitForWebSocketResponse, sendChatReset } = require('./slack');

async function main() {
    const server = http.createServer(async (req, res) => {
        if (req.method.toUpperCase() === 'POST') {
            const body = await readBody(req, true);
            console.log(body)
            const modelName = "Claude";

            const {
                messages
            } = body;
            res.setHeader('Content-Type', 'application/json');
            console.log("messages\n",messages);
            slices = splitJsonArray(messages, 12000);            

            const id = `chatcmpl-${(Math.random().toString(36).slice(2))}`;
            const created = Math.floor(Date.now() / 1000);
            
            await sendChatReset();
            wait(3000);
            const result = await waitForWebSocketResponse(slices);
            console.log(result)
            res.write(JSON.stringify({
                id, created,
                object: 'chat.completion',
                model: modelName,
                choices: [{
                    message: {
                        role: 'assistant',
                        content: result,
                    },
                    finish_reason: 'stop',
                    index: 0,
                }]
            }));

            res.end();
        } else {
            res.setHeader('Content-Type', 'application/json');
            res.write(JSON.stringify({
                object: 'list',
                data: [
                    { id: 'claude-v1', object: 'model', created: Date.now(), owned_by: 'anthropic', permission: [], root: 'claude-v1', parent: null },
                ]
            }));
        }
        res.end();
    });

    server.listen(5004, '0.0.0.0', () => {
        console.log(`proxy for Slack's claude-v1: 'http://127.0.0.1:5004/'`);
    });
}

main().catch(console.error);