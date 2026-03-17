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
        問題: item["問題"] || item["問題テキスト"] || "",
        画像: item["画像"] || item["問題画像"] || "",
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
const gameState = {
    phase: "waiting",
    questionIndex: 0,
    nextQuestionIndex: null,
    answersByUser: {},
};

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

function getConnectedClientUserNames() {
    return [...new Set(
        getConnectedClients()
            .map((client) => String(client.userName || "").trim())
            .filter((userName) => userName.length > 0)
    )];
}

function getAnsweredCount() {
    const connectedUserNames = new Set(getConnectedClientUserNames());
    return Object.keys(gameState.answersByUser).filter((userName) => connectedUserNames.has(userName)).length;
}

function getQuestionType(question) {
    return question?.クイズ種別 || null;
}

function resetAnswers() {
    gameState.answersByUser = {};
}

function calculateGeoguessrDistance(answerPoint, correctPoint) {
    const dx = Number(answerPoint?.x) - Number(correctPoint?.x);
    const dy = Number(answerPoint?.y) - Number(correctPoint?.y);
    return Math.sqrt((dx * dx) + (dy * dy));
}

function calculateChoiceScore(question, answer) {
    return Number(answer?.selectedIndex) === Number(question?.正解) ? 100 : 0;
}

function calculateSortableScore(question, answer) {
    const correctOrder = Array.isArray(question?.正解) ? question.正解 : [];
    const submittedOrder = Array.isArray(answer?.order) ? answer.order : [];
    let correctCount = 0;

    for (let i = 0; i < correctOrder.length; i += 1) {
        if (Number(submittedOrder[i]) === Number(correctOrder[i])) {
            correctCount += 1;
        }
    }

    return correctCount * 100;
}

function calculateGeoguessrScore(question, answer) {
    const correctPoint = question?.正解座標;
    const answerPoint = answer?.point;
    if (!correctPoint || !answerPoint) {
        return 0;
    }

    const distance = calculateGeoguessrDistance(answerPoint, correctPoint);
    if (!Number.isFinite(distance) || distance >= 500) {
        return 0;
    }

    return Math.round(100 * (1 - (distance / 500)));
}

function calculateScoreForAnswer(question, answer) {
    if (!question || !answer) {
        return 0;
    }

    if (question.クイズ種別 === "choice") {
        return calculateChoiceScore(question, answer);
    }

    if (question.クイズ種別 === "sortable") {
        return calculateSortableScore(question, answer);
    }

    if (question.クイズ種別 === "geoguessr") {
        return calculateGeoguessrScore(question, answer);
    }

    return 0;
}

function applyScoresForCurrentQuestion() {
    const question = getCurrentQuestion();
    if (!question) {
        return;
    }

    for (const userName of getConnectedClientUserNames()) {
        const answer = gameState.answersByUser[userName];
        const delta = calculateScoreForAnswer(question, answer);
        changeScore(scores, userName, delta);
    }

    persistScores();
}

function parseClientAnswer(question, message) {
    if (!question) {
        return null;
    }

    if (question.クイズ種別 === "choice") {
        const selectedIndex = Number(message?.selectedIndex);
        if (!Number.isInteger(selectedIndex) || selectedIndex < 1) {
            return null;
        }
        return { selectedIndex };
    }

    if (question.クイズ種別 === "sortable") {
        const order = Array.isArray(message?.order)
            ? message.order.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 1)
            : [];
        if (order.length === 0) {
            return null;
        }
        return { order };
    }

    if (question.クイズ種別 === "geoguessr") {
        const point = {
            x: Number(message?.point?.x),
            y: Number(message?.point?.y),
        };
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
            return null;
        }
        return { point };
    }

    return null;
}

function sanitizeQuestion(question) {
    if (!question) {
        return null;
    }

    if (question.クイズ種別 === "choice") {
        return {
            type: "choice",
            title: question.問題,
            questionNumber: gameState.questionIndex + 1,
            options: question.選択肢,
            correctIndex: question.正解,
        };
    }

    if (question.クイズ種別 === "sortable") {
        return {
            type: "sortable",
            title: question.問題,
            questionNumber: gameState.questionIndex + 1,
            options: question.選択肢,
            correctOrder: question.正解,
        };
    }

    if (question.クイズ種別 === "geoguessr") {
        return {
            type: "geoguessr",
            title: question.問題,
            questionNumber: gameState.questionIndex + 1,
            imageUrl: question.画像 || question.imageUrl || question.ImageUrl || "",
            answerPoint: question.正解座標,
            answerRadius: question.正解許容値,
        };
    }

    return null;
}

function getCurrentQuestion() {
    return allQuestionList[gameState.questionIndex] ?? null;
}

function getSortedLeaderboardEntries() {
    const connectedUserNames = getConnectedClientUserNames();
    const entries = connectedUserNames.map((userName) => ({
        userName,
        score: Number(scores[userName]) || 0,
    }));

    entries.sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }

        return a.userName.localeCompare(b.userName, "ja");
    });

    return entries;
}

function buildLeaderboardForWs(ws = null) {
    const entries = getSortedLeaderboardEntries();
    const top3 = entries.slice(0, 3);

    let myRank = null;
    let myScore = null;
    let pointsToThird = 0;

    if (ws && ws.role === "client" && ws.userName) {
        const myIndex = entries.findIndex((entry) => entry.userName === ws.userName);
        if (myIndex >= 0) {
            myRank = myIndex + 1;
            myScore = entries[myIndex].score;

            if (myRank > 3 && entries[2]) {
                pointsToThird = Math.max(0, entries[2].score - myScore);
            }
        }
    }

    return {
        top3,
        myRank,
        myScore,
        pointsToThird,
    };
}

function getMyAnswer(ws) {
    if (!ws || ws.role !== "client" || !ws.userName) {
        return null;
    }

    return gameState.answersByUser[ws.userName] ?? null;
}

function buildStatePayload(ws = null) {
    return {
        type: "state-sync",
        state: {
            phase: gameState.phase,
            questionIndex: gameState.questionIndex,
            question: sanitizeQuestion(getCurrentQuestion()),
            clientCount: getConnectedClients().length,
            answeredCount: getAnsweredCount(),
            scores,
            myAnswer: getMyAnswer(ws),
            leaderboard: buildLeaderboardForWs(ws),
            isFinalScoreboard: gameState.phase === "scoreboard" && gameState.nextQuestionIndex === 0,
        },
    };
}

function broadcastState() {
    for (const host of getConnectedHosts()) {
        sendJson(host, buildStatePayload(host));
    }

    for (const client of getConnectedClients()) {
        sendJson(client, buildStatePayload(client));
    }
}

function goToFirstQuestion() {
    if (allQuestionList.length === 0) {
        gameState.phase = "waiting";
        gameState.questionIndex = 0;
        resetAnswers();
        return;
    }

    gameState.phase = "question";
    gameState.questionIndex = 0;
    gameState.nextQuestionIndex = null;
    resetAnswers();
}

function advanceGameState() {
    if (allQuestionList.length === 0) {
        gameState.phase = "waiting";
        gameState.questionIndex = 0;
        gameState.nextQuestionIndex = null;
        resetAnswers();
        return;
    }

    if (gameState.phase === "waiting") {
        goToFirstQuestion();
        return;
    }

    if (gameState.phase === "question") {
        applyScoresForCurrentQuestion();
        gameState.phase = "answer";
        return;
    }

    if (gameState.phase === "scoreboard") {
        if (gameState.nextQuestionIndex === 0) {
            gameState.phase = "waiting";
            gameState.questionIndex = 0;
            gameState.nextQuestionIndex = null;
            resetAnswers();
            return;
        }

        const fallbackNextIndex = (gameState.questionIndex + 1) % allQuestionList.length;
        gameState.questionIndex = Number.isInteger(gameState.nextQuestionIndex)
            ? gameState.nextQuestionIndex
            : fallbackNextIndex;
        gameState.nextQuestionIndex = null;
        gameState.phase = "question";
        resetAnswers();
        return;
    }

    const nextIndex = (gameState.questionIndex + 1) % allQuestionList.length;
    const currentType = getQuestionType(getCurrentQuestion());
    const nextType = getQuestionType(allQuestionList[nextIndex]);

    if (currentType && nextType && currentType !== nextType) {
        gameState.phase = "scoreboard";
        gameState.nextQuestionIndex = nextIndex;
        return;
    }

    gameState.phase = "question";
    gameState.questionIndex = nextIndex;
    gameState.nextQuestionIndex = null;
    resetAnswers();
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
            sendJson(ws, buildStatePayload(ws));
            broadcastState();
            return;
        }

        if (message?.type === "host-next") {
            if (ws.role !== "host") {
                sendJson(ws, {
                    type: "error",
                    message: "only host can control state",
                });
                return;
            }

            advanceGameState();
            broadcastState();
            return;
        }

        if (message?.type === "host-reset") {
            if (ws.role !== "host") {
                sendJson(ws, {
                    type: "error",
                    message: "only host can control state",
                });
                return;
            }

            gameState.phase = "waiting";
            gameState.questionIndex = 0;
            gameState.nextQuestionIndex = null;
            resetAnswers();
            for (const userName of userList) {
                scores[userName] = 0;
            }
            persistScores();
            broadcastState();
            return;
        }

        if (message?.type === "answer-submit") {
            if (ws.role !== "client" || !ws.userName) {
                return;
            }

            if (gameState.phase !== "question") {
                return;
            }

            const question = getCurrentQuestion();
            const parsedAnswer = parseClientAnswer(question, message);
            if (!parsedAnswer) {
                return;
            }

            gameState.answersByUser[ws.userName] = parsedAnswer;
            broadcastState();
            return;
        }

        console.log("[ws message]", message);
    });

    ws.on("close", () => {
        console.log("WebSocket client disconnected");
        if (ws.role === "client" && ws.userName) {
            delete gameState.answersByUser[ws.userName];
        }
        notifyHostClientCount();
        broadcastState();
    });
});

server.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});