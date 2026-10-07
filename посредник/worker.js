// Посредник сайта викторин (Cloudflare Worker).
//
// Зачем: ключи GitHub, Pexels и OpenRouter нельзя положить в сам сайт —
// он лежит в открытом репозитории, и ключи увидели бы все (а GitHub свой
// токен в открытом коде сразу отзывает). Поэтому ключи живут здесь, в
// секретах Cloudflare, а сайт ходит к сервисам через этого посредника.
// Подруге и Вике ничего вписывать не нужно.
//
// Секреты (Cloudflare → Worker → Settings → Variables and Secrets):
//   GH_TOKEN        — токен GitHub (Contents: read/write, Actions: read)
//   PEXELS_KEY      — ключ Pexels
//   OPENROUTER_KEY  — ключ OpenRouter
//   SITE_PASS       — пароль сайта; страница шлёт его в заголовке X-Pass
//
// Дороги:
//   /gh/<путь>      → https://api.github.com/<путь>   (только наши репозитории)
//   /pexels/<путь>  → https://api.pexels.com/<путь>   (только поиск, GET)
//   /ai/<путь>      → https://openrouter.ai/api/v1/<путь> (models, chat/completions)
//   /ping           → проверка пароля

const ОТКУДА = [
  "https://gallxxxx.github.io",
  "https://otdai-ii.ru",
  "https://www.otdai-ii.ru",
];

// Писать посредник даёт только в эти репозитории — даже с паролем
// через него не сделать ничего с остальным аккаунтом.
const РЕПО = /^repos\/gallxxxx\/(tiktok-quiz|quiz-source|quiz)(\/|$|\?)/i;

const заголовкиCORS = (origin) => ({
  "Access-Control-Allow-Origin": ОТКУДА.includes(origin) ? origin : ОТКУДА[0],
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, X-Pass, X-GitHub-Api-Version",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
});

const ответ = (код, тело, origin) =>
  new Response(JSON.stringify(тело), {
    status: код,
    headers: { "Content-Type": "application/json", ...заголовкиCORS(origin) },
  });

// Сравнение без утечки по времени.
const совпало = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || !b) return false;
  if (a.length !== b.length) return false;
  let разница = 0;
  for (let i = 0; i < b.length; i += 1) разница |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return разница === 0;
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: заголовкиCORS(origin) });
    }
    // Страница шлёт пароль зашифрованным (encodeURIComponent): иначе
    // русские буквы в заголовке не прошли бы.
    let пароль = request.headers.get("X-Pass") || "";
    try { пароль = decodeURIComponent(пароль); } catch { пароль = ""; }
    if (!совпало(пароль, (env.SITE_PASS || "").trim())) {
      return ответ(403, { message: "неверный пароль сайта" }, origin);
    }

    const url = new URL(request.url);
    const путь = url.pathname.replace(/^\/+/, "");
    const хвост = (префикс) =>
      decodeURIComponent(путь.slice(префикс.length)) + url.search;

    let куда, заголовки;
    if (путь === "ping") {
      return ответ(200, {
        ok: true,
        github: Boolean(env.GH_TOKEN),
        pexels: Boolean(env.PEXELS_KEY),
        ai: Boolean(env.OPENROUTER_KEY),
      }, origin);
    } else if (путь.startsWith("gh/")) {
      const api = хвост("gh/");
      if (!РЕПО.test(api) && api.split("?")[0] !== "user") {
        return ответ(403, { message: "этот путь посредник не пропускает" }, origin);
      }
      // «tiktok-quiz» — старое имя «quiz-source». GitHub перенаправил бы
      // сам, но на редиректе запрос с телом (отправка выпуска) ломается,
      // поэтому подставляем новое имя сразу.
      куда = "https://api.github.com/"
        + api.replace(/^repos\/gallxxxx\/tiktok-quiz(?=\/|$|\?)/i, "repos/gallxxxx/quiz-source");
      заголовки = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: "Bearer " + env.GH_TOKEN,
        "User-Agent": "quiz-site-proxy",
      };
    } else if (путь.startsWith("pexels/")) {
      const api = хвост("pexels/");
      if (request.method !== "GET" || !/^(v1\/search|videos\/search)/.test(api)) {
        return ответ(403, { message: "этот путь посредник не пропускает" }, origin);
      }
      куда = "https://api.pexels.com/" + api;
      заголовки = { Authorization: env.PEXELS_KEY };
    } else if (путь.startsWith("ai/")) {
      const api = хвост("ai/");
      if (!/^(models|chat\/completions)(\?|$)/.test(api)) {
        return ответ(403, { message: "этот путь посредник не пропускает" }, origin);
      }
      куда = "https://openrouter.ai/api/v1/" + api;
      заголовки = {
        Authorization: "Bearer " + env.OPENROUTER_KEY,
        "HTTP-Referer": "https://gallxxxx.github.io/quiz/",
        "X-Title": "quiz site",
      };
    } else {
      return ответ(404, { message: "нет такой дороги" }, origin);
    }

    const тип = request.headers.get("Content-Type");
    if (тип) заголовки["Content-Type"] = тип;
    const сТелом = !["GET", "HEAD"].includes(request.method);

    const там = await fetch(куда, {
      method: request.method,
      headers: заголовки,
      body: сТелом ? request.body : undefined,
    });
    const назад = new Headers(заголовкиCORS(origin));
    назад.set("Content-Type", там.headers.get("Content-Type") || "application/json");
    назад.set("Cache-Control", "no-store");
    return new Response(там.body, { status: там.status, headers: назад });
  },
};
