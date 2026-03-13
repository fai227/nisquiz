"use strict";

// 画面要素
const screens = {
    title: document.getElementById("screen-title"),
    waiting: document.getElementById("screen-waiting"),
    choice: document.getElementById("screen-choice"),
    sortable: document.getElementById("screen-sortable"),
    geoguessr: document.getElementById("screen-geoguessr"),
};

const allScreens = Object.values(screens);

// すべて非表示 -> 指定画面のみ表示
function showOnlyScreen(screenKey) {
    allScreens.forEach((screen) => {
        screen.hidden = true;
    });
    screens[screenKey].hidden = false;
}

// 1. タイトル画面
function showTitleScreen() {
    showOnlyScreen("title");
}

// 2. 待機画面（表示文言を引数で受ける）
function showWaitingScreen(message) {
    showOnlyScreen("waiting");
    const p = screens.waiting.querySelector("p");
    if (p) {
        p.textContent = message;
    }
}

// 3. 択一クイズ画面（選択肢文字列リストを引数で受ける）
function showChoiceQuizScreen(options) {
    showOnlyScreen("choice");

    const optionButtons = screens.choice.querySelectorAll('button[type="button"]');

    optionButtons.forEach((button, index) => {
        const text = options[index];
        if (typeof text === "string") {
            button.hidden = false;
            button.textContent = text;
            button.value = text;
        } else {
            button.hidden = true;
            button.textContent = "";
            button.value = "";
        }
    });
}

// 4. 入れ替えクイズ画面（選択肢文字列リストを引数で受ける）
function showSortableQuizScreen(options) {
    showOnlyScreen("sortable");

    const list = document.getElementById("sortable-list");
    if (!list) {
        return;
    }

    list.innerHTML = "";
    options.forEach((text, index) => {
        const li = document.createElement("li");
        li.textContent = text;
        li.dataset.index = String(index);
        list.appendChild(li);
    });
}

// 5. ジオゲッサー画面（引数なし）
function showGeoguessrQuizScreen() {
    showOnlyScreen("geoguessr");
}

// form submitで画面遷移デモが止まらないように一旦抑止
document.querySelectorAll("form").forEach((form) => {
    form.addEventListener("submit", (event) => {
        event.preventDefault();
    });
});

// 後で他ファイルから呼びやすいように公開
window.showTitleScreen = showTitleScreen;
window.showWaitingScreen = showWaitingScreen;
window.showChoiceQuizScreen = showChoiceQuizScreen;
window.showSortableQuizScreen = showSortableQuizScreen;
window.showGeoguessrQuizScreen = showGeoguessrQuizScreen;

// デモ: タイトルから5秒ごとに順番に切り替え
const demoSequence = [
    () => showTitleScreen(),
    () => showWaitingScreen("クイズ開始までしばらくお待ちください。"),
    () => showChoiceQuizScreen(["選択肢1", "選択肢2", "選択肢3", "選択肢4"]),
    () => showSortableQuizScreen(["項目A", "項目B", "項目C", "項目D"]),
    () => showGeoguessrQuizScreen(),
];

let current = 0;
demoSequence[current]();

setInterval(() => {
    current = (current + 1) % demoSequence.length;
    demoSequence[current]();
}, 5000);