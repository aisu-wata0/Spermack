const http = require('http');
const WebSocket = require('ws');

const { readBody, splitJsonArray } = require('./utils');
const { retryableWebSocketResponse, textResetSignal } = require('./slack');

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
            // remove trailing whitespace from messages
            messages.forEach(message => {
                message.content = message.content.replace(/\s+$/gm, "");
            });
            slices = splitJsonArray(messages, 12000);

            const id = `chatcmpl-${(Math.random().toString(36).slice(2))}`;
            const created = Math.floor(Date.now() / 1000);
            
            try {
                if (!stream) {
                    const result = await retryableWebSocketResponse(slices, stream);
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
                    const sendChunks = (nextChunk) => {
                        if (nextChunk.done) {
                            res.write('\ndata: [DONE]');
                            return;
                        }
                        let response_data = {};
                        let reset = false;
                        let content = nextChunk.value.toString();
                        if (nextChunk.value.toString().startsWith(textResetSignal)) {
                            reset = true;
                            content = nextChunk.value.toString().slice(textResetSignal.length);
                        }
                        response_data = {
                            id,
                            created,
                            object: 'chat.completion',
                            model: modelName,
                            choices: [{
                                delta: {
                                    role: 'assistant',
                                    content: content,
                                },
                                finish_reason: 'continue',
                                index: 0,
                            }],
                            reset: reset,
                        };
                        
                        res.write('\ndata: ' + JSON.stringify(response_data));
                    }
                    await retryableWebSocketResponse(slices, sendChunks);
                    res.end();
                }
            } catch (error) {
                console.error(error)
                console.error(error.message + "| " + "Error while sending message/replying");
                res.end();
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