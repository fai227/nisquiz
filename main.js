const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const { parse } = require("csv-parse/sync");

const app = express();
const port = 3000;

app.use(express.static("public"));

app.get("/api/users", (_req, res) => {
    res.json({
        users: userList,
    });
});

function loadCsvAsObjectList(relativeFilePath) {
    const absolutePath = path.join(__dirname, relativeFilePath);
    const csvText = fs.readFileSync(absolutePath, "utf8");

    return parse(csvText, {
        bom: true,
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true,
    });
}

function loadUserList(relativeFilePath) {
    const absolutePath = path.join(__dirname, relativeFilePath);
    if (!fs.existsSync(absolutePath)) {
        console.warn(`[users] file not found: ${relativeFilePath}`);
        return [];
    }

    const fileText = fs.readFileSync(absolutePath, "utf8");
    return fileText
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}

function createInitialScores(users) {
    return Object.fromEntries(users.map((userName) => [userName, 0]));
}

function loadScores(relativeFilePath, users) {
    const absolutePath = path.join(__dirname, relativeFilePath);
    if (!fs.existsSync(absolutePath)) {
        return createInitialScores(users);
    }

    try {
        const raw = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
        const scores = createInitialScores(users);
        for (const userName of users) {
            const score = raw?.[userName];
            scores[userName] = Number.isFinite(score) ? score : 0;
        }
        return scores;
    } catch (error) {
        console.warn(`[scores] failed to load: ${relativeFilePath}`, error);
        return createInitialScores(users);
    }
}

function saveScores(relativeFilePath, scores) {
    const absolutePath = path.join(__dirname, relativeFilePath);
    fs.writeFileSync(absolutePath, `${JSON.stringify(scores, null, 2)}\n`, "utf8");
}

function changeScore(scores, userName, delta) {
    if (!(userName in scores)) {
        scores[userName] = 0;
    }
    scores[userName] += delta;
    return scores[userName];
}

function shuffleArray(array) {
    const copied = [...array];
    for (let i = copied.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copied[i], copied[j]] = [copied[j], copied[i]];
    }
    return copied;
}

function buildChoiceQuizList() {
    const rawChoiceQuizList = loadCsvAsObjectList("quiz/問題集(択一クイズ).csv");

    return rawChoiceQuizList.map((item) => {
        const {
            回答1,
            回答2,
            回答3,
            回答4,
            ...rest
        } = item;

        const correctAnswerIndex = Number(item["正解"]) - 1;
        const optionsWithSourceIndex = [回答1, 回答2, 回答3, 回答4].map((text, index) => ({
            text,
            sourceIndex: index,
        }));
        const shuffledOptions = shuffleArray(optionsWithSourceIndex);
        const newCorrectAnswerIndex = shuffledOptions.findIndex((option) => option.sourceIndex === correctAnswerIndex);

        return {
            ...rest,
            難易度: Number(item["難易度"]),
            正解: newCorrectAnswerIndex + 1,
            選択肢: shuffledOptions.map((option) => option.text),
        };
    });
}

function buildSortableQuizList() {
    const rawSortableQuizList = loadCsvAsObjectList("quiz/問題集(入れ替えクイズ).csv");

    return rawSortableQuizList.map((item) => {
        const {
            回答1,
            回答2,
            回答3,
            回答4,
            ...rest
        } = item;

        const optionsWithSourceIndex = [回答1, 回答2, 回答3, 回答4].map((text, index) => ({
            text,
            sourceIndex: index,
        }));
        const shuffledOptions = shuffleArray(optionsWithSourceIndex);

        const originalCorrectOrder = String(item["正解"])
            .split(",")
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
            .map((value) => Number(value) - 1)
            .filter((value) => Number.isInteger(value) && value >= 0 && value < optionsWithSourceIndex.length);

        const newCorrectOrder = originalCorrectOrder
            .map((sourceIndex) => shuffledOptions.findIndex((option) => option.sourceIndex === sourceIndex))
            .filter((newIndex) => newIndex >= 0)
            .map((newIndex) => newIndex + 1);

        return {
            ...rest,
            難易度: Number(item["難易度"]),
            正解: newCorrectOrder,
            選択肢: shuffledOptions.map((option) => option.text),
        };
    });
}

function parseCoordinate(value) {
    const [xRaw, yRaw] = String(value)
        .split(",")
        .map((part) => part.trim());

    return {
        x: Number(xRaw),
        y: Number(yRaw),
    };
}

function buildGeoguessrQuizList() {
    const rawGeoguessrQuizList = loadCsvAsObjectList("quiz/問題集(ジオゲッサー).csv");

    return rawGeoguessrQuizList.map((item) => ({
        ...item,
        難易度: Number(item["難易度"]),
        正解許容値: Number(item["正解許容値"]),
        正解座標: parseCoordinate(item["正解座標"]),
    }));
}

function sortByDifficulty(list) {
    return [...list].sort((a, b) => {
        const diffA = Number.isFinite(a?.難易度) ? a.難易度 : Number.POSITIVE_INFINITY;
        const diffB = Number.isFinite(b?.難易度) ? b.難易度 : Number.POSITIVE_INFINITY;
        return diffA - diffB;
    });
}

function splitEasyAndHard(sortedList, easyCount = 5) {
    return {
        easy: sortedList.slice(0, easyCount),
        hard: sortedList.slice(easyCount),
    };
}

function withQuizType(list, quizType) {
    return list.map((question) => ({
        ...question,
        クイズ種別: quizType,
    }));
}

function buildUnifiedQuestionList(choiceList, sortableList, geoguessrList) {
    const choiceSorted = sortByDifficulty(choiceList);
    const sortableSorted = sortByDifficulty(sortableList);
    const geoguessrSorted = sortByDifficulty(geoguessrList);

    const { easy: choiceEasy, hard: choiceHard } = splitEasyAndHard(choiceSorted, 5);
    const { easy: sortableEasy, hard: sortableHard } = splitEasyAndHard(sortableSorted, 5);
    const { easy: geoguessrEasy, hard: geoguessrHard } = splitEasyAndHard(geoguessrSorted, 5);

    return [
        ...withQuizType(choiceEasy, "choice"),
        ...withQuizType(sortableEasy, "sortable"),
        ...withQuizType(geoguessrEasy, "geoguessr"),
        ...withQuizType(choiceHard, "choice"),
        ...withQuizType(sortableHard, "sortable"),
        ...withQuizType(geoguessrHard, "geoguessr"),
    ];
}

const choiceQuizList = buildChoiceQuizList();
const sortableQuizList = buildSortableQuizList();
const geoguessrQuizList = buildGeoguessrQuizList();
const allQuestionList = buildUnifiedQuestionList(choiceQuizList, sortableQuizList, geoguessrQuizList);
const userList = loadUserList("data/user.txt");
const scoresFilePath = "data/scores.json";
const scores = loadScores(scoresFilePath, userList);

console.log("userList:", userList);

if (!fs.existsSync(path.join(__dirname, scoresFilePath))) {
    saveScores(scoresFilePath, scores);
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const WS_OPEN = 1;

function sendJson(ws, payload) {
    if (ws.readyState === WS_OPEN) {
        ws.send(JSON.stringify(payload));
    }
}

function getConnectedClients() {
    return Array.from(wss.clients).filter((client) => client.readyState === WS_OPEN && client.role === "client");
}

function getConnectedHosts() {
    return Array.from(wss.clients).filter((client) => client.readyState === WS_OPEN && client.role === "host");
}

function broadcastToHosts(payload) {
    const hosts = getConnectedHosts();
    for (const host of hosts) {
        sendJson(host, payload);
    }
}

function broadcastToClients(payload) {
    const clients = getConnectedClients();
    for (const client of clients) {
        sendJson(client, payload);
    }
}

function notifyHostClientCount() {
    broadcastToHosts({
        type: "client-count",
        count: getConnectedClients().length,
    });
}

function persistScores() {
    saveScores(scoresFilePath, scores);
}

process.on("SIGINT", () => {
    persistScores();
    process.exit(0);
});

process.on("SIGTERM", () => {
    persistScores();
    process.exit(0);
});

wss.on("connection", (ws) => {
    console.log("WebSocket client connected");
    ws.role = null;
    ws.userName = null;

    ws.on("message", (raw) => {
        let message;
        try {
            message = JSON.parse(raw.toString());
        } catch (error) {
            console.warn("[ws] invalid json message", error);
            return;
        }

        if (message?.type === "register") {
            const role = message?.role;
            if (role !== "host" && role !== "client") {
                sendJson(ws, {
                    type: "error",
                    message: "invalid role",
                });
                return;
            }

            ws.role = role;
            if (role === "client") {
                ws.userName = String(message?.userName || "").trim();
                console.log(`[ws] client registered: ${ws.userName || "(unknown)"}`);
            } else {
                console.log("[ws] host registered");
            }

            notifyHostClientCount();
            return;
        }

        console.log("[ws message]", message);
    });

    ws.on("close", () => {
        console.log("WebSocket client disconnected");
        notifyHostClientCount();
    });
});

server.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});