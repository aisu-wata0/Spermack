const http = require('http');
const WebSocket = require('ws');

const { readBody, splitJsonArray, wait } = require('./utils');
const { getWebSocketResponse, sendChatReset } = require('./slack');

async function main() {
    const server = http.createServer(async (req, res) => {
        if (req.method.toUpperCase() === 'POST') {
            const body = await readBody(req, true);
            console.log({ ...body, messages: "[look at tavern's log]"})
            const modelName = "Claude";
            const {
                messages,
                stream,
            } = body;
            // console.log("messages\n",messages);
            slices = splitJsonArray(messages, 12000);

            const id = `chatcmpl-${(Math.random().toString(36).slice(2))}`;
            const created = Math.floor(Date.now() / 1000);
            
            await sendChatReset();
            if (!stream) {
                const result = await getWebSocketResponse(slices, stream);
                console.log(result)
                res.setHeader('Content-Type', 'application/json');
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
                const resultStream = await getWebSocketResponse(slices, stream);
                const reader = resultStream.getReader();
                async function processData({ done, value }) {
                    if (done) {
                        res.write('\ndata: [DONE]');
                        return;
                    }
                    response_data = {
                        id,
                        created,
                        object: 'chat.completion',
                        model: modelName,
                        choices: [{
                            delta: {
                                role: 'assistant',
                                content: value.toString(),
                            },
                            finish_reason: 'continue',
                            index: 0,
                        }],
                    };
                    res.write('\ndata: ' + JSON.stringify(response_data));
                    const nextChunk = await reader.read();
                    await processData(nextChunk);
                }

                const firstChunk = await reader.read();
                await processData(firstChunk);
            }
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