const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const { parse } = require("csv-parse/sync");

const app = express();
const port = 3000;

app.use(express.static("public"));

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

const choiceQuizList = buildChoiceQuizList();
const sortableQuizList = buildSortableQuizList();
const geoguessrQuizList = buildGeoguessrQuizList();

console.log("choiceQuizList:", choiceQuizList);
console.log("sortableQuizList:", sortableQuizList);
console.log("geoguessrQuizList:", geoguessrQuizList);

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
    console.log("WebSocket client connected");

    ws.on("message", (raw) => {
        console.log("[ws message]", raw.toString());
    });

    ws.on("close", () => {
        console.log("WebSocket client disconnected");
    });
});

server.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});