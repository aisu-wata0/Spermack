const http = require('http');
const WebSocket = require('ws');

const { readBody, splitJsonArray, wait } = require('./utils');
const { waitForWebSocketResponse, streamWebSocketResponse, sendChatReset } = require('./slack');

const { streaming } = require('./config');

async function main() {
    const server = http.createServer(async (req, res) => {
        if (req.method.toUpperCase() === 'POST') {
            const body = await readBody(req, true);
            console.log(body)
            const modelName = "Claude";

            const {
                messages,
            } = body;
            res.setHeader('Content-Type', 'application/json');
            console.log("messages\n",messages);
            slices = splitJsonArray(messages, 12000);            

            const id = `chatcmpl-${(Math.random().toString(36).slice(2))}`;
            const created = Math.floor(Date.now() / 1000);
            
            await sendChatReset();
            wait(2000);
            if (!streaming) {
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
            } else {
                const ws = new WebSocket('ws://server/generate_openai');

                const stream = await streamWebSocketResponse(slices);
                const reader = stream.getReader();
                let index = 0;
                reader.read(result => {
                    ws.send(JSON.stringify({
                        id,
                        created,
                        object: 'chat.completion',
                        model: modelName,
                        choices: [{
                            message: {
                                role: 'assistant',
                                content: result.value
                            },
                            // finish_reason: 'stop',
                            index: 0
                        }],
                        index: index,
                    }) + '\n');

                    index++;
                })

                ws.onclose = () => { /* handle close */ }
            }
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