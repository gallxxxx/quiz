// Экран «Картинки» у викторины «Это или то».
//
// Вика: «при выборе картинок предложенные картинки не прогружаются».
// Виноват был голый `fetch` без срока: на мобильном интернете запрос
// умеет не оборваться, а зависнуть, и «Ищу…» висело до бесконечности.
// Ровно эта же беда была у отправки и там уже вылечена — здесь про неё
// просто забыли.
//
// Проверяем то, что видит человек: сколько бы сток ни молчал, экран
// обязан ответить словами и дать кнопку, а не крутиться.
import fs from "node:fs";
import { JSDOM } from "jsdom";

const ФАЙЛ = new URL("../index.html", import.meta.url);
const ошибки = [];
let сделано = 0;
const так = (что, условие, чего) => {
  сделано += 1;
  if (условие) console.log("  ок   " + что);
  else { ошибки.push(что + (чего ? " — " + чего : "")); console.log("  МИМО " + что); }
};

// Что отдаёт «сток», решает эта ручка — её крутим по ходу проверки.
let повадка = "молчит";
let спрошено = [];

const фотоPexels = (n) => ({
  src: { medium: "https://пример/мал-" + n + ".jpg",
         large: "https://пример/большой-" + n + ".jpg" },
  photographer: "кто-то", url: "",
});
const фотоOpenverse = (n) => ({
  url: "https://опенверс/большой-" + n + ".jpg",
  thumbnail: "https://опенверс/мал-" + n + ".jpg",
  creator: "кто-то", foreign_landing_url: "",
});

// Зависший запрос — это НЕ отказ: обещание, которое никогда не сбудется,
// пока его не оборвут по сроку. Слушаем signal, как настоящий fetch.
const никогда = (опции) => new Promise((_, отказ) => {
  const сигнал = опции && опции.signal;
  if (!сигнал) return;
  сигнал.addEventListener("abort", () => {
    const e = new Error("прервано по сроку");
    e.name = "AbortError";
    отказ(e);
  });
});

const фейкFetch = async (адрес, опции) => {
  const строка = String(адрес);
  спрошено.push(строка);
  if (повадка === "молчит") return никогда(опции);
  if (повадка === "устал") return { ok: false, status: 429, json: async () => ({}) };
  if (повадка === "пусто") {
    return { ok: true, status: 200,
             json: async () => (строка.includes("openverse")
                                ? { results: [] } : { photos: [], videos: [] }) };
  }
  // «Только Openverse»: ключа Pexels нет вовсе или сток по нему пуст.
  if (повадка === "только опенверс") {
    if (строка.includes("openverse")) {
      return { ok: true, status: 200,
               json: async () => ({ results: [1, 2].map(фотоOpenverse) }) };
    }
    return { ok: true, status: 200, json: async () => ({ photos: [], videos: [] }) };
  }
  if (строка.includes("openverse")) {
    return { ok: true, status: 200,
             json: async () => ({ results: [1, 2].map(фотоOpenverse) }) };
  }
  return { ok: true, status: 200,
           json: async () => ({ photos: [1, 2, 3].map(фотоPexels), videos: [] }) };
};

const html = fs.readFileSync(ФАЙЛ, "utf8");
const хвост = `
<script>
window.__жалобы = [];
window.addEventListener("error", (e) => window.__жалобы.push(String(e.message)));
window.__дай = {
  открытьЭкран: (что) => открытьЭкран(что),
  состояние: () => state,
  слоты: () => рисоватьСлоты(),
  кадр: (какой) => рисоватьКадр(какой),
  искать: (п, р, пл, с) => искать(п, р, пл, с),
  срокПоиска: (мс) => { СРОК_ПОИСКА = мс; },
};
</script>`;

const dom = new JSDOM(html.replace("</body>", хвост + "</body>"), {
  runScripts: "dangerously",
  url: "https://gallxxxx.github.io/quiz/",
  pretendToBeVisual: true,
  beforeParse(окно) {
    окно.localStorage.setItem("викторина-доступ",
      JSON.stringify({ pexels: "ключ-для-проверки", токен: "" }));
    окно.fetch = фейкFetch;
    окно.XMLHttpRequest = class {
      constructor() { this.upload = {}; this.timeout = 0; }
      open() {} setRequestHeader() {}
      send() { setTimeout(() => { this.status = 404; this.responseText = "{}";
        if (this.onload) this.onload({}); }, 5); }
    };
    окно.alert = (т) => окно.__жалобы.push("ВСПЛЫЛО ОКНО: " + String(т).slice(0, 60));
  },
});
const окно = dom.window;
const $ = (id) => окно.document.getElementById(id);
const ждать = (мс) => new Promise((г) => setTimeout(г, мс));
await ждать(300);

const открытьПервыйСлот = async () => {
  окно.__дай.открытьЭкран("picts");
  await ждать(30);
  const слот = $("слоты").querySelector(".slot");
  слот.querySelector(".открыть")
      .dispatchEvent(new окно.Event("click", { bubbles: true }));
  return слот;
};

// Срок на странице — 12 секунд, заходов два. Ждать честные 24 секунды на
// каждый случай бессмысленно, поэтому укорачиваем: проверяем поведение,
// а не выдержку.
окно.__дай.срокПоиска(60);

console.log("\n1. Сток молчит — экран не зависает на «Ищу…»");
повадка = "молчит";
const слот = await открытьПервыйСлот();
const сетка = слот.querySelector(".vars");
await ждать(20);
так("пока ищем — так и написано", /Ищу/.test(сетка.textContent), сетка.textContent);
// Два захода по 60 мс плюс запас. Настоящий срок дал бы то же самое,
// только через полминуты.
await ждать(400);
так("дождались ответа, а не вечного «Ищу…»",
    !/Ищу/.test(сетка.textContent), сетка.textContent);
так("сказано, что виноват сток, а не слово",
    /не ответил/.test(сетка.textContent), сетка.textContent);
так("и предложено нажать ещё раз",
    Array.from(сетка.querySelectorAll("button"))
      .some((к) => /Попробовать ещё раз/.test(к.textContent)));

console.log("\n2. Сток устал (429) — говорим правду и даём кнопку");
повадка = "устал";
спрошено = [];
слот.querySelector(".ещё").dispatchEvent(new окно.Event("click", { bubbles: true }));
await ждать(200);
так("«Ищу…» сменилось ответом", !/Ищу/.test(сетка.textContent), сетка.textContent);
так("сказано, что виноват сток, а не слово",
    /не ответил/.test(сетка.textContent), сетка.textContent);
const ещёРаз = Array.from(сетка.querySelectorAll("button"))
  .find((к) => /Попробовать ещё раз/.test(к.textContent));
так("есть кнопка «попробовать ещё раз»", !!ещёРаз);

console.log("\n3. Повтор берёт ту же страницу, а не следующую");
повадка = "как надо";
спрошено = [];
const было = сетка.querySelectorAll(".v").length;
if (ещёРаз) {
  ещёРаз.dispatchEvent(new окно.Event("click", { bubbles: true }));
  await ждать(200);
}
const страницы = спрошено.map((а) => (а.match(/[?&]page=(\d+)/) || [])[1]).filter(Boolean);
так("спрошена первая страница выдачи",
    страницы.length > 0 && страницы[0] === "1", JSON.stringify(страницы));
так("картинки показаны", сетка.querySelectorAll(".v").length > 0,
    String(сетка.querySelectorAll(".v").length));
так("а до повтора их и не было", было === 0, String(было));

console.log("\n4. Молчание поверх УЖЕ показанных — тоже словами");
// Тут прежние картинки остаются на экране, и без объяснения это выглядит
// как «кнопка не работает»: нажал, подождал, всё то же самое.
повадка = "молчит";
слот.querySelector(".ещё").dispatchEvent(new окно.Event("click", { bubbles: true }));
// Молчащих запросов тут три подряд (две фразы Pexels и Openverse), у
// каждого по два захода: ждём с запасом, иначе следующий раздел начнётся
// поверх недоигранного и затрёт строчку.
await ждать(900);
const весть0 = слот.querySelector(".весть");
так("сказано, что сток промолчал",
    весть0 && /не ответил/.test(весть0.textContent), весть0 && весть0.textContent);
так("а картинки при этом остались", сетка.querySelectorAll(".v").length > 0,
    String(сетка.querySelectorAll(".v").length));

console.log("\n5. Пусто — это другое, и сказано другое");
повадка = "пусто";
спрошено = [];
слот.querySelector(".ещё").dispatchEvent(new окно.Event("click", { bubbles: true }));
await ждать(200);
// Прежние картинки при этом остаются на экране — показать и правда есть
// что, а строчка про «новых больше нет» живёт под кнопками.
const весть = слот.querySelector(".весть");
так("сказано про слово, а не про сток",
    весть && /Новых больше нет/.test(весть.textContent),
    весть && весть.textContent);
так("прежние картинки не пропали", сетка.querySelectorAll(".v").length > 0,
    String(сетка.querySelectorAll(".v").length));
так("кнопки «ещё раз» тут нет — она бы не помогла",
    !Array.from(сетка.querySelectorAll("button"))
      .some((к) => /Попробовать ещё раз/.test(к.textContent)));

console.log("\n6. Режим «видеоклипы»: клипов нет — показываем фотографии");
повадка = "только опенверс";
спрошено = [];
const найдено = await окно.__дай.искать("Pizza", "видео", "крупный", 1);
так("что-то нашлось, а не пустой экран", найдено.length > 0, String(найдено.length));
так("это Openverse — запасной, которому ключ не нужен",
    найдено.length > 0 && найдено[0].источник === "Openverse",
    найдено[0] && найдено[0].источник);
так("сток про клипы всё-таки спросили",
    спрошено.some((а) => /videos\/search/.test(а)));

console.log("\n7. Своё фото видно в предпросмотре кадра");
const state = окно.__дай.состояние();
state.rounds[0].photos = state.rounds[0].photos || {};
state.rounds[0].picks = {};
state.rounds[0].photos.top = "БАЗА64БАЗА64";
окно.__дай.открытьЭкран("editor");
await ждать(50);
окно.__дай.кадр("editor");
const снимокВерх = $("кадр-editor").querySelectorAll(".снимок")[0];
так("картинка в кадре есть",
    /БАЗА64БАЗА64/.test(снимокВерх.style.backgroundImage),
    снимокВерх.style.backgroundImage);
так("и у неё правильная шапка, иначе браузер её не покажет",
    /data:image\/jpeg;base64,БАЗА64/.test(снимокВерх.style.backgroundImage),
    снимокВерх.style.backgroundImage);

console.log("\n8. Белый лист в предпросмотре — лист, а не две половины");
// Александр: «почему показывается что это выглядит так, если должно быть
// по другому». Предпросмотр рисовал белому листу те же две половины и
// красил верхнюю белым, нижнюю чёрным — кадра, которого в ролике нет.
const холст = $("кадр-editor").querySelector(".кадр");
так("при цветном оформлении половины крашеные",
    холст.querySelectorAll(".пол")[1].style.background !== "transparent",
    холст.querySelectorAll(".пол")[1].style.background);
так("и полоса-таймер посередине есть", !!холст.querySelector(".полоса"));

state.theme = "белое";
окно.__дай.кадр("editor");
так("кадр помечен листом", холст.classList.contains("лист"));
так("половины не крашены вовсе",
    Array.from(холст.querySelectorAll(".пол"))
      .every((п) => п.style.background === "transparent"),
    Array.from(холст.querySelectorAll(".пол")).map((п) => п.style.background).join("|"));
так("полосы-таймера нет — время идёт кольцом вокруг кружка",
    !холст.querySelector(".полоса"));
так("посередине кружок «OR»",
    холст.querySelector(".кружок")
    && /OR/.test(холст.querySelector(".кружок").textContent));
так("номер раунда остался", !!холст.querySelector(".номер"));
так("сказано, что фон сотрётся на сборке",
    !$("кадр-про-лист").classList.contains("hide"));

state.theme = "терракота";
окно.__дай.кадр("editor");
так("вернулись к цветному — лист снят", !холст.classList.contains("лист"));
так("и строчка про лист спрятана",
    $("кадр-про-лист").classList.contains("hide"));

так("ошибок по дороге нет", окно.__жалобы.length === 0,
    JSON.stringify(окно.__жалобы));

console.log("\n———");
console.log(ошибки.length
  ? "НЕ СОШЛОСЬ (" + ошибки.length + " из " + сделано + "):\n  " + ошибки.join("\n  ")
  : "Сошлось всё: " + сделано + " проверок.");
окно.close();
process.exit(ошибки.length ? 1 : 0);
