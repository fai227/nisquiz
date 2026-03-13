const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");

const app = express();
const port = 3000;

app.use(express.static("public"));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const normalClients = new Set();
const hostClients = new Set();

const scores = new Map();

function sendJson(ws, command, data) {
    ws.send(JSON.stringify({ command, data }));
}

function broadcastToNormal(command, data) {
    const payload = JSON.stringify({ command, data });
    for (const client of normalClients) {
        if (client.readyState === client.OPEN) {
            client.send(payload);
        }
    }
}

function broadcastAllUsers() {
    broadcastToNormal("all-users", null);
}

function safeParseJson(raw) {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function isInteger(value) {
    return Number.isInteger(value);
}

function handleNormalCommand(ws, command, data) {
    const clientId = ws._socket.remoteAddress + ":" + ws._socket.remotePort;
    const current = scores.get(clientId) || { choice: null, sortable: null, geoguessr: null };

    if (command === "answer-choice") {
        if (!isInteger(data)) {
            sendJson(ws, "error", "answer-choice expects int");
            return;
        }
        current.choice = data;
        scores.set(clientId, current);
        return;
    }

    if (command === "answer-sortable") {
        if (!isInteger(data)) {
            sendJson(ws, "error", "answer-sortable expects int");
            return;
        }
        current.sortable = data;
        scores.set(clientId, current);
        return;
    }

    if (command === "answer-geoguessr") {
        if (!Array.isArray(data) || data.length !== 2 || !isInteger(data[0]) || !isInteger(data[1])) {
            sendJson(ws, "error", "answer-geoguessr expects [int, int]");
            return;
        }
        current.geoguessr = [data[0], data[1]];
        scores.set(clientId, current);
        return;
    }

    sendJson(ws, "error", `unknown normal command: ${command}`);
}

function handleHostCommand(_ws, command) {
    if (command === "get-scores") {
        const result = [];
        for (const [clientId, value] of scores.entries()) {
            result.push({ clientId, answers: value });
        }
        // Host outbound command is intentionally empty for now.
        console.log("[get-scores]", result);
        return;
    }

    sendJson(ws, "error", `unknown host command: ${command}`);
}

wss.on("connection", (ws) => {
    ws.role = "unregistered";

    ws.on("message", (raw) => {
        const message = safeParseJson(raw.toString());
        if (!message || typeof message.command !== "string") {
            sendJson(ws, "error", "invalid message format");
            return;
        }

        const { command, data } = message;

        if (command === "normal") {
            if (ws.role !== "unregistered") {
                sendJson(ws, "error", "role already set");
                return;
            }
            ws.role = "normal";
            normalClients.add(ws);
            broadcastAllUsers();
            return;
        }

        if (command === "host") {
            if (ws.role !== "unregistered") {
                sendJson(ws, "error", "role already set");
                return;
            }
            ws.role = "host";
            hostClients.add(ws);
            return;
        }

        if (ws.role === "normal") {
            handleNormalCommand(ws, command, data);
            return;
        }

        if (ws.role === "host") {
            handleHostCommand(ws, command, data);
            return;
        }

        sendJson(ws, "error", "send role command first: normal or host");
    });

    ws.on("close", () => {
        if (ws.role === "normal") {
            normalClients.delete(ws);
            broadcastAllUsers();
        }
        if (ws.role === "host") {
            hostClients.delete(ws);
        }
    });
});

server.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});