// Atualiza os campos "lendo" / "ouvindo" / data no index.html usando a API do
// Spotify (tocando agora, com fallback pra última música ouvida) e o feed RSS
// público do Goodreads (prateleira "currently-reading").
//
// Não usa nenhuma dependência externa (Node 18+ já tem fetch global), pra não
// precisar de npm install no workflow. Faz substituição por regex nos spans
// com id fixo, sem reformatar o resto do arquivo.

import { readFileSync, writeFileSync } from "node:fs";

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REFRESH_TOKEN,
  GOODREADS_USER_ID,
} = process.env;

async function getSpotifyAccessToken() {
  const basic = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: SPOTIFY_REFRESH_TOKEN,
    }),
  });
  if (!res.ok) {
    console.error("falha ao renovar token do spotify:", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  return data.access_token;
}

function trackLabel(track) {
  const artists = track.artists.map((a) => a.name).join(", ");
  return `${track.name} - ${artists}`;
}

async function getNowListening() {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !SPOTIFY_REFRESH_TOKEN) return null;

  const token = await getSpotifyAccessToken();
  if (!token) return null;
  const headers = { Authorization: `Bearer ${token}` };

  try {
    const current = await fetch("https://api.spotify.com/v1/me/player/currently-playing", { headers });
    if (current.status === 200) {
      const data = await current.json();
      if (data?.item) return trackLabel(data.item);
    }

    const recent = await fetch("https://api.spotify.com/v1/me/player/recently-played?limit=1", { headers });
    if (recent.ok) {
      const data = await recent.json();
      const track = data.items?.[0]?.track;
      if (track) return trackLabel(track);
    }
  } catch (err) {
    console.error("erro consultando spotify:", err);
  }
  return null;
}

async function getNowReading() {
  if (!GOODREADS_USER_ID) return null;

  try {
    const res = await fetch(
      `https://www.goodreads.com/review/list_rss/${GOODREADS_USER_ID}?shelf=currently-reading`
    );
    if (!res.ok) return null;
    const xml = await res.text();

    const itemMatch = xml.match(/<item>([\s\S]*?)<\/item>/);
    if (!itemMatch) return null;
    const item = itemMatch[1];

    const title = extractTag(item, "title");
    const author = extractTag(item, "author_name");
    if (!title) return null;
    return author ? `${title} - ${author}` : title;
  } catch (err) {
    console.error("erro consultando goodreads:", err);
    return null;
  }
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, "s"));
  return m ? m[1].trim() : null;
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function replaceSpan(html, id, text) {
  const re = new RegExp(`(<span[^>]*\\bid="${id}"[^>]*>)([\\s\\S]*?)(</span>)`);
  if (!re.test(html)) {
    console.warn(`span #${id} não encontrado, pulando`);
    return html;
  }
  return html.replace(re, (_m, open, _old, close) => `${open}${escapeHtml(text)}${close}`);
}

function formatDate(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

const [listening, reading] = await Promise.all([getNowListening(), getNowReading()]);
const date = formatDate(new Date());

console.log({ listening, reading, date });

const path = "index.html";
let html = readFileSync(path, "utf8");

if (listening) html = replaceSpan(html, "now-ouvindo", listening);
if (reading) html = replaceSpan(html, "now-lendo", reading);
if (listening || reading) {
  html = replaceSpan(html, "now-date", date);
  html = replaceSpan(html, "now-carimbo-date", date);
}

writeFileSync(path, html);
