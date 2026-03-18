import express from "express";
console.log("VORTEX-MD SERVER STARTING...");

// Global error handling for unhandled rejections to prevent crashes and messy logs
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

import { createServer as createViteServer } from "vite";
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage, downloadContentFromMessage, jidNormalizedUser } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import os from 'os';
import yts from 'yt-search';
import axios from 'axios';

// Axios error interceptor for better debugging
axios.interceptors.response.use(
    response => response,
    error => {
        if (error.response && error.response.status === 428) {
            console.error('Precondition Required (428) error detected from URL:', error.config.url);
        }
        return Promise.reject(error);
    }
);
import ytdl from '@distube/ytdl-core';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import schedule from 'node-schedule';
import gis from 'g-i-s';
import { GoogleGenAI } from '@google/genai';
import { Sticker, createSticker, StickerTypes } from 'wa-sticker-formatter';
import FormData from 'form-data';

// Remove canvas imports as they might cause build/runtime issues in this environment
// import { createCanvas, loadImage } from 'canvas';

let aiClient: GoogleGenAI | null = null;
function getAi(): GoogleGenAI {
    if (!aiClient) {
        const key = process.env.GEMINI_API_KEY;
        if (!key) throw new Error('GEMINI_API_KEY environment variable is required');
        aiClient = new GoogleGenAI({ apiKey: key });
    }
    return aiClient;
}

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

async function getMediaBuffer(message: any, type: 'image' | 'video' | 'sticker') {
    const stream = await downloadContentFromMessage(message, type);
    let buffer = Buffer.from([]);
    for await(const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    return buffer;
}

// Economy and Games state
const economyPath = path.join(process.cwd(), 'economy.json');
let economy: { [key: string]: { balance: number, lastDaily: number, bank?: number } } = {};
if (fs.existsSync(economyPath)) {
    try {
        economy = JSON.parse(fs.readFileSync(economyPath, 'utf-8'));
    } catch (e) {
        console.error('Failed to load economy:', e);
    }
}
function saveEconomy() {
    fs.writeFileSync(economyPath, JSON.stringify(economy, null, 2));
}

const afkPath = path.join(process.cwd(), 'afk.json');
let afkUsers: { [key: string]: { reason: string, time: number } } = {};
if (fs.existsSync(afkPath)) {
    try {
        afkUsers = JSON.parse(fs.readFileSync(afkPath, 'utf-8'));
    } catch (e) {
        console.error('Failed to load AFK users:', e);
    }
}
function saveAfk() {
    fs.writeFileSync(afkPath, JSON.stringify(afkUsers, null, 2));
}

const tttGames: { [key: string]: any } = {};

const app = express();
app.use(express.json());

// Create public/uploads directory if it doesn't exist
const uploadsDir = path.join(process.cwd(), 'public/uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve uploaded files
app.use('/uploads', express.static(uploadsDir));

const PORT = 3000;

const startTime = Date.now();

// AI Tasks Queue
interface AITask {
    id: string;
    prompt: string;
    remoteJid: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
}
const aiTasks: AITask[] = [];

const commands = [
    // 1. General (10)
    { name: 'pair', emoji: '🔗', module: 'General' },
    { name: 'menu', emoji: '📜', module: 'General' },
    { name: 'info', emoji: 'ℹ️', module: 'General' },
    { name: 'ping', emoji: '🏓', module: 'General' },
    { name: 'owner', emoji: '👑', module: 'General' },
    { name: 'rules', emoji: '📋', module: 'General' },
    { name: 'help', emoji: '❓', module: 'General' },
    { name: 'creator', emoji: '👨‍💻', module: 'General' },
    { name: 'runtime', emoji: '⏳', module: 'General' },
    { name: 'lang', emoji: '🌐', module: 'General' },
    { name: 'speed', emoji: '⚡', module: 'General' },
    { name: 'donate', emoji: '☕', module: 'General' },
    { name: 'autoreact', emoji: '🎭', module: 'General' },
    { name: 'autostatus', emoji: '🗽', module: 'General' },
    { name: 'aisupport', emoji: '🤖', module: 'General' },
    { name: 'react', emoji: '💥', module: 'General' },

    // 2. Group Moderation (20)
    { name: 'kick', emoji: '👢', module: 'Moderation' },
    { name: 'add', emoji: '➕', module: 'Moderation' },
    { name: 'promote', emoji: '⭐', module: 'Moderation' },
    { name: 'demote', emoji: '⬇️', module: 'Moderation' },
    { name: 'mute', emoji: '🔇', module: 'Moderation' },
    { name: 'unmute', emoji: '🔊', module: 'Moderation' },
    { name: 'setname', emoji: '✏️', module: 'Moderation' },
    { name: 'setdesc', emoji: '📝', module: 'Moderation' },
    { name: 'link', emoji: '🔗', module: 'Moderation' },
    { name: 'revoke', emoji: '🔄', module: 'Moderation' },
    { name: 'tagall', emoji: '📢', module: 'Moderation' },
    { name: 'hidetag', emoji: '👻', module: 'Moderation' },
    { name: 'warn', emoji: '⚠️', module: 'Moderation' },
    { name: 'unwarn', emoji: '✅', module: 'Moderation' },
    { name: 'warnings', emoji: '📊', module: 'Moderation' },
    { name: 'del', emoji: '🗑️', module: 'Moderation' },
    { name: 'lock', emoji: '🔒', module: 'Moderation' },
    { name: 'unlock', emoji: '🔓', module: 'Moderation' },
    { name: 'setpp', emoji: '🖼️', module: 'Moderation' },
    { name: 'leave', emoji: '👋', module: 'Moderation' },
    { name: 'nsfw', emoji: '🔞', module: 'Moderation' },

    // 3. Protection (20)
    { name: 'welcome', emoji: '👋', module: 'Moderation' },
    { name: 'antilink', emoji: '🚫', module: 'Protection' },
    { name: 'antispam', emoji: '🛡️', module: 'Protection' },
    { name: 'antibot', emoji: '🤖', module: 'Protection' },
    { name: 'antifake', emoji: '🎭', module: 'Protection' },
    { name: 'antidelete', emoji: '👁️', module: 'Protection' },
    { name: 'antiviewonce', emoji: '📸', module: 'Protection' },
    { name: 'antitoxic', emoji: '🤬', module: 'Protection' },
    { name: 'autokick', emoji: '⚡', module: 'Protection' },
    { name: 'onlyadmin', emoji: '👑', module: 'Protection' },
    { name: 'antiforeign', emoji: '🌍', module: 'Protection' },
    { name: 'antipicture', emoji: '🖼️', module: 'Protection' },
    { name: 'antivideo', emoji: '🎥', module: 'Protection' },
    { name: 'antiaudio', emoji: '🎵', module: 'Protection' },
    { name: 'antidocument', emoji: '📄', module: 'Protection' },
    { name: 'anticall', emoji: '📞', module: 'Protection' },
    { name: 'antimention', emoji: '📢', module: 'Protection' },
    { name: 'antiforward', emoji: '➡️', module: 'Protection' },
    { name: 'anticontact', emoji: '👤', module: 'Protection' },
    { name: 'antilocation', emoji: '📍', module: 'Protection' },
    { name: 'antipoll', emoji: '📊', module: 'Protection' },
    { name: 'nsfw', emoji: '🔞', module: 'Protection' },

    // 4. Owner (15)
    { name: 'ban', emoji: '🔨', module: 'Owner' },
    { name: 'unban', emoji: '🕊️', module: 'Owner' },
    { name: 'broadcast', emoji: '📡', module: 'Owner' },
    { name: 'block', emoji: '🛑', module: 'Owner' },
    { name: 'unblock', emoji: '🟢', module: 'Owner' },
    { name: 'setprefix', emoji: '⌨️', module: 'Owner' },
    { name: 'setmode', emoji: '⚙️', module: 'Owner' },
    { name: 'restart', emoji: '🔄', module: 'Owner' },
    { name: 'join', emoji: '🚪', module: 'Owner' },
    { name: 'clear', emoji: '🧹', module: 'Owner' },
    { name: 'addprem', emoji: '💎', module: 'Owner' },
    { name: 'delprem', emoji: '🗑️', module: 'Owner' },
    { name: 'listprem', emoji: '📝', module: 'Owner' },
    { name: 'banchat', emoji: '🚫', module: 'Owner' },
    { name: 'unbanchat', emoji: '✅', module: 'Owner' },
    { name: 'public', emoji: '🔓', module: 'Owner' },
    { name: 'private', emoji: '🔒', module: 'Owner' },

    // 5. Tools (15)
    { name: 'sticker', emoji: '🖼️', module: 'Tools' },
    { name: 'getsticker', emoji: '🔍', module: 'Tools' },
    { name: 'toimg', emoji: '📷', module: 'Tools' },
    { name: 'tts', emoji: '🗣️', module: 'Tools' },
    { name: 'translate', emoji: '🌐', module: 'Tools' },
    { name: 'weather', emoji: '🌤️', module: 'Tools' },
    { name: 'calc', emoji: '🧮', module: 'Tools' },
    { name: 'wiki', emoji: '📚', module: 'Tools' },
    { name: 'github', emoji: '🐙', module: 'Tools' },
    { name: 'crypto', emoji: '💰', module: 'Tools' },
    { name: 'qr', emoji: '🔳', module: 'Tools' },
    { name: 'shorturl', emoji: '🔗', module: 'Tools' },
    { name: 'base64', emoji: '🔐', module: 'Tools' },
    { name: 'password', emoji: '🔑', module: 'Tools' },
    { name: 'styletext', emoji: '🔤', module: 'Tools' },
    { name: 'readmore', emoji: '📖', module: 'Tools' },
    { name: 'math', emoji: '➗', module: 'Tools' },
    { name: 'timer', emoji: '⏱️', module: 'Tools' },
    { name: 'reminder', emoji: '⏰', module: 'Tools' },

    // 6. Fun (10)
    { name: 'joke', emoji: '😂', module: 'Fun' },
    { name: 'meme', emoji: '🤣', module: 'Fun' },
    { name: 'lyrics', emoji: '🎤', module: 'Fun' },
    { name: 'truth', emoji: '🤫', module: 'Fun' },
    { name: 'dare', emoji: '😈', module: 'Fun' },
    { name: 'flipcoin', emoji: '🪙', module: 'Fun' },
    { name: 'roll', emoji: '🎲', module: 'Fun' },
    { name: '8ball', emoji: '🎱', module: 'Fun' },
    { name: 'ship', emoji: '❤️', module: 'Fun' },
    { name: 'rate', emoji: '⭐', module: 'Fun' },
    { name: 'dog', emoji: '🐶', module: 'Fun' },
    { name: 'cat', emoji: '🐱', module: 'Fun' },
    { name: 'fact', emoji: '🧠', module: 'Fun' },
    { name: 'bug', emoji: '🐛', module: 'Fun' },

    // 7. Downloads (10)
    { name: 'play', emoji: '🎵', module: 'Downloads' },
    { name: 'ytmp3', emoji: '🎧', module: 'Downloads' },
    { name: 'ytmp4', emoji: '🎬', module: 'Downloads' },
    { name: 'ig', emoji: '📸', module: 'Downloads' },
    { name: 'fb', emoji: '📘', module: 'Downloads' },
    { name: 'tiktok', emoji: '🎵', module: 'Downloads' },
    { name: 'twitter', emoji: '🐦', module: 'Downloads' },
    { name: 'spotify', emoji: '🎧', module: 'Downloads' },
    { name: 'pinterest', emoji: '📌', module: 'Downloads' },
    { name: 'gitclone', emoji: '🐙', module: 'Downloads' },

    // 8. Search (10)
    { name: 'google', emoji: '🔍', module: 'Search' },
    { name: 'wiki', emoji: '📚', module: 'Search' },
    { name: 'pinterest', emoji: '📌', module: 'Search' },
    { name: 'github', emoji: '🐙', module: 'Search' },
    { name: 'npm', emoji: '📦', module: 'Search' },
    { name: 'lyrics', emoji: '🎤', module: 'Search' },
    { name: 'imdb', emoji: '🎬', module: 'Search' },
    { name: 'weather', emoji: '🌤️', module: 'Search' },
    { name: 'define', emoji: '📖', module: 'Search' },
    { name: 'anime', emoji: '🌸', module: 'Search' },
    { name: 'manga', emoji: '📚', module: 'Search' },
    { name: 'waifu', emoji: '👗', module: 'Anime' },
    { name: 'neko', emoji: '🐱', module: 'Anime' },
    { name: 'shinobu', emoji: '🗡️', module: 'Anime' },
    { name: 'megumin', emoji: '💥', module: 'Anime' },
    { name: 'hug', emoji: '🫂', module: 'Anime' },
    { name: 'kiss', emoji: '💋', module: 'Anime' },
    { name: 'pat', emoji: '🤚', module: 'Anime' },
    { name: 'slap', emoji: '👋', module: 'Anime' },
    { name: 'kill', emoji: '💀', module: 'Anime' },
    { name: 'dance', emoji: '💃', module: 'Anime' },
    { name: 'happy', emoji: '😊', module: 'Anime' },
    { name: 'wink', emoji: '😉', module: 'Anime' },
    { name: 'poke', emoji: '👉', module: 'Anime' },
    { name: 'smile', emoji: '😁', module: 'Anime' },
    { name: 'wave', emoji: '👋', module: 'Anime' },
    { name: 'bite', emoji: '🦷', module: 'Anime' },
    { name: 'blush', emoji: '😊', module: 'Anime' },
    { name: 'yeet', emoji: '🚀', module: 'Anime' },
    { name: 'bonk', emoji: '🔨', module: 'Anime' },
    { name: 'smug', emoji: '😏', module: 'Anime' },
    { name: 'nom', emoji: '😋', module: 'Anime' },
    { name: 'glomp', emoji: '🫂', module: 'Anime' },
    { name: 'highfive', emoji: '🙌', module: 'Anime' },
    { name: 'handhold', emoji: '🤝', module: 'Anime' },
    { name: 'cringe', emoji: '😬', module: 'Anime' },
    { name: 'bully', emoji: '😤', module: 'Anime' },
    { name: 'cuddle', emoji: '🫂', module: 'Anime' },
    { name: 'cry', emoji: '😭', module: 'Anime' },
    { name: 'awoo', emoji: '🐺', module: 'Anime' },
    { name: 'lick', emoji: '👅', module: 'Anime' },
    { name: 'hentai', emoji: '🔞', module: 'Anime' },

    // 9. AI (3)
    { name: 'ai', emoji: '🧠', module: 'AI' },
    { name: 'gpt', emoji: '💬', module: 'AI' },
    { name: 'gemini', emoji: '✨', module: 'AI' },

    // 10. Media & Status (10)
    { name: 'vv', emoji: '👁️', module: 'Media' },
    { name: 'status', emoji: '📥', module: 'Media' },
    { name: 'getstatus', emoji: '📲', module: 'Media' },
    { name: 'save', emoji: '💾', module: 'Media' },
    { name: 'forward', emoji: '➡️', module: 'Media' },
    { name: 'quote', emoji: '💬', module: 'Media' },
    { name: 'take', emoji: 'steal', module: 'Media' },
    { name: 'wm', emoji: '©️', module: 'Media' },
    { name: 'exif', emoji: '📸', module: 'Media' },
    { name: 'tourl', emoji: '🔗', module: 'Media' },

    // 11. Advanced Moderation (20)
    { name: 'warn1', emoji: '1️⃣', module: 'Advanced Mod' },
    { name: 'warn2', emoji: '2️⃣', module: 'Advanced Mod' },
    { name: 'warn3', emoji: '3️⃣', module: 'Advanced Mod' },
    { name: 'resetwarns', emoji: '🔄', module: 'Advanced Mod' },
    { name: 'kickall', emoji: '👢', module: 'Advanced Mod' },
    { name: 'banall', emoji: '🔨', module: 'Advanced Mod' },
    { name: 'muteall', emoji: '🔇', module: 'Advanced Mod' },
    { name: 'unmuteall', emoji: '🔊', module: 'Advanced Mod' },
    { name: 'lockall', emoji: '🔒', module: 'Advanced Mod' },
    { name: 'unlockall', emoji: '🔓', module: 'Advanced Mod' },
    { name: 'setrules', emoji: '📋', module: 'Advanced Mod' },
    { name: 'delrules', emoji: '🗑️', module: 'Advanced Mod' },
    { name: 'setwelcome', emoji: '👋', module: 'Advanced Mod' },
    { name: 'delwelcome', emoji: '🗑️', module: 'Advanced Mod' },
    { name: 'setgoodbye', emoji: '👋', module: 'Advanced Mod' },
    { name: 'delgoodbye', emoji: '🗑️', module: 'Advanced Mod' },
    { name: 'setpromote', emoji: '⭐', module: 'Advanced Mod' },
    { name: 'delpromote', emoji: '🗑️', module: 'Advanced Mod' },
    { name: 'setdemote', emoji: '⬇️', module: 'Advanced Mod' },
    { name: 'deldemote', emoji: '🗑️', module: 'Advanced Mod' },

    // 12. Economy & RPG (20)
    { name: 'balance', emoji: '💰', module: 'Economy' },
    { name: 'bank', emoji: '🏦', module: 'Economy' },
    { name: 'deposit', emoji: '📥', module: 'Economy' },
    { name: 'withdraw', emoji: '📤', module: 'Economy' },
    { name: 'transfer', emoji: '💸', module: 'Economy' },
    { name: 'daily', emoji: '📅', module: 'Economy' },
    { name: 'weekly', emoji: '📆', module: 'Economy' },
    { name: 'monthly', emoji: '🗓️', module: 'Economy' },
    { name: 'work', emoji: '💼', module: 'Economy' },
    { name: 'mine', emoji: '⛏️', module: 'Economy' },
    { name: 'fish', emoji: '🎣', module: 'Economy' },
    { name: 'hunt', emoji: '🏹', module: 'Economy' },
    { name: 'rob', emoji: '🦹', module: 'Economy' },
    { name: 'gamble', emoji: '🎲', module: 'Economy' },
    { name: 'slots', emoji: '🎰', module: 'Economy' },
    { name: 'roulette', emoji: '🎡', module: 'Economy' },
    { name: 'inventory', emoji: '🎒', module: 'Economy' },
    { name: 'shop', emoji: '🛒', module: 'Economy' },
    { name: 'buy', emoji: '🛍️', module: 'Economy' },
    { name: 'sell', emoji: '💰', module: 'Economy' },

    // 13. Games (15)
    { name: 'tictactoe', emoji: '❌', module: 'Games' },
    { name: 'delttt', emoji: '🗑️', module: 'Games' },
    { name: 'guessword', emoji: '🔠', module: 'Games' },
    { name: 'guessnumber', emoji: '🔢', module: 'Games' },
    { name: 'mathgame', emoji: '➗', module: 'Games' },
    { name: 'trivia', emoji: '🧠', module: 'Games' },
    { name: 'hangman', emoji: '🪢', module: 'Games' },
    { name: 'wordchain', emoji: '🔗', module: 'Games' },
    { name: 'rps', emoji: '✊', module: 'Games' },
    { name: 'connect4', emoji: '🔴', module: 'Games' },
    { name: 'chess', emoji: '♟️', module: 'Games' },
    { name: 'checkers', emoji: '🏁', module: 'Games' },
    { name: 'uno', emoji: '🃏', module: 'Games' },
    { name: 'poker', emoji: '🃏', module: 'Games' },
    { name: 'blackjack', emoji: '🃏', module: 'Games' },

    // 14. Utility (15)
    { name: 'afk', emoji: '💤', module: 'Utility' },
    { name: 'unafk', emoji: '🔔', module: 'Utility' },
    { name: 'report', emoji: '🚩', module: 'Utility' },
    { name: 'suggest', emoji: '💡', module: 'Utility' },
    { name: 'bug', emoji: '🐛', module: 'Utility' },
    { name: 'feedback', emoji: '📝', module: 'Utility' },
    { name: 'poll', emoji: '📊', module: 'Utility' },
    { name: 'vote', emoji: '🗳️', module: 'Utility' },
    { name: 'endpoll', emoji: '🛑', module: 'Utility' },
    { name: 'calculate', emoji: '🧮', module: 'Utility' },
    { name: 'convert', emoji: '🔄', module: 'Utility' },
    { name: 'timezone', emoji: '🌍', module: 'Utility' },
    { name: 'currency', emoji: '💱', module: 'Utility' },
    { name: 'crypto', emoji: '🪙', module: 'Utility' },
    { name: 'stocks', emoji: '📈', module: 'Utility' },

    // 15. System (10)
    { name: 'sysinfo', emoji: '💻', module: 'System' },
    { name: 'cpu', emoji: '🧠', module: 'System' },
    { name: 'ram', emoji: '💾', module: 'System' },
    { name: 'disk', emoji: '💿', module: 'System' },
    { name: 'network', emoji: '🌐', module: 'System' },
    { name: 'os', emoji: '🖥️', module: 'System' },
    { name: 'uptime', emoji: '⏳', module: 'System' },
    { name: 'logs', emoji: '📜', module: 'System' },
    { name: 'clearlogs', emoji: '🧹', module: 'System' },
    { name: 'update', emoji: '🔄', module: 'System' },

    // 16. Developer (10)
    { name: 'eval', emoji: '💻', module: 'Developer' },
    { name: 'exec', emoji: '⚙️', module: 'Developer' },
    { name: 'shell', emoji: '🐚', module: 'Developer' },
    { name: 'db', emoji: '🗄️', module: 'Developer' },
    { name: 'query', emoji: '🔍', module: 'Developer' },
    { name: 'backup', emoji: '💾', module: 'Developer' },
    { name: 'restore', emoji: '🔄', module: 'Developer' },
    { name: 'test', emoji: '🧪', module: 'Developer' },
    { name: 'debug', emoji: '🐛', module: 'Developer' },
    { name: 'reload', emoji: '🔄', module: 'Developer' },

    // 17. Anime & Manga (15)
    { name: 'waifu', emoji: '🌸', module: 'Anime' },
    { name: 'neko', emoji: '🐱', module: 'Anime' },
    { name: 'husbando', emoji: '🤵', module: 'Anime' },
    { name: 'kitsune', emoji: '🦊', module: 'Anime' },
    { name: 'hug', emoji: '🫂', module: 'Anime' },
    { name: 'kiss', emoji: '💋', module: 'Anime' },
    { name: 'pat', emoji: '✋', module: 'Anime' },
    { name: 'slap', emoji: '👋', module: 'Anime' },
    { name: 'cuddle', emoji: '🤗', module: 'Anime' },
    { name: 'cry', emoji: '😢', module: 'Anime' },
    { name: 'smug', emoji: '😏', module: 'Anime' },
    { name: 'bonk', emoji: '🔨', module: 'Anime' },
    { name: 'yeet', emoji: '🚀', module: 'Anime' },
    { name: 'blush', emoji: '😳', module: 'Anime' },
    { name: 'smile', emoji: '😊', module: 'Anime' },
    { name: 'wave', emoji: '👋', module: 'Anime' },
    { name: 'highfive', emoji: '🙌', module: 'Anime' },
    { name: 'handhold', emoji: '🤝', module: 'Anime' },
    { name: 'nom', emoji: '😋', module: 'Anime' },
    { name: 'bite', emoji: '🦷', module: 'Anime' },
    { name: 'glare', emoji: '😠', module: 'Anime' },
    { name: 'bully', emoji: '😈', module: 'Anime' },
    { name: 'poke', emoji: '👉', module: 'Anime' },
    { name: 'wink', emoji: '😉', module: 'Anime' },
    { name: 'dance', emoji: '💃', module: 'Anime' },
    { name: 'cringe', emoji: '😬', module: 'Anime' },
    { name: 'megumin', emoji: '💥', module: 'Anime' },
    { name: 'awoo', emoji: '🐺', module: 'Anime' },
    { name: 'hentai', emoji: '🔞', module: 'Anime' },
];

declare global {
    var spamTracker: { [key: string]: number[] };
}

function formatUptime(uptimeMs: number) {
    const seconds = Math.floor((uptimeMs / 1000) % 60);
    const minutes = Math.floor((uptimeMs / (1000 * 60)) % 60);
    const hours = Math.floor((uptimeMs / (1000 * 60 * 60)) % 24);
    const days = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0) parts.push(`${seconds}s`);

    return parts.join(' ') || '0s';
}

function generateMenu(username: string, config: any) {
    const uptime = formatUptime(Date.now() - startTime);
    const status = config.mode === 'public' ? 'Public' : 'Private';
    
    let menuText = `╭── ❀ VORTEX-MD ❀──╮
│ 🤵 User: ${username}
│ 🤖 Bot: Vortex-MD
│ 🛠 Status: ${status}
│ 🕝 Uptime: ${uptime}
│ 👑 Owner: Samy Charles
╰────────────────╯\n\n`;

    const modules: { [key: string]: typeof commands } = {};
    for (const cmd of commands) {
        if (!modules[cmd.module]) modules[cmd.module] = [];
        modules[cmd.module].push(cmd);
    }

    for (const [moduleName, cmds] of Object.entries(modules)) {
        menuText += `╭─ ◈ ${moduleName} ◈ ─╮\n`;
        for (const cmd of cmds) {
            menuText += `│ ${cmd.emoji} ${config.prefix}${cmd.name}\n`;
        }
        menuText += `╰────────────────╯\n\n`;
    }

    menuText += `🔗 *Lien Officiel:* https://whatsapp.com/channel/0029Vb7AruX8fewz8dSRD340`;

    return menuText.trim();
}

interface BotSession {
    id: string;
    sock: any;
    status: 'disconnected' | 'connecting' | 'connected';
    phoneNumber?: string;
    isReconnecting: boolean;
    reconnectInterval: NodeJS.Timeout | null;
    decryptionErrors: number;
    lastHeartbeat?: number;
    lastAttempt?: number;
}
const sessions = new Map<string, BotSession>();
const userWarnings = new Map<string, number>();

/**
 * Automatically restarts all existing sessions found in the sessions directory.
 */
async function autoRestartSessions() {
    const sessionsDir = path.join(process.cwd(), 'sessions');
    if (!fs.existsSync(sessionsDir)) return;

    const folders = fs.readdirSync(sessionsDir);
    console.log(`[AutoRestart] Found ${folders.length} potential sessions to restart.`);
    
    for (const folder of folders) {
        const sessionPath = path.join(sessionsDir, folder);
        if (fs.statSync(sessionPath).isDirectory()) {
            console.log(`[AutoRestart] Restarting session: ${folder}`);
            // Small delay between restarts to avoid overwhelming the system
            await new Promise(resolve => setTimeout(resolve, 2000));
            startBot(folder).catch(err => {
                console.error(`[AutoRestart] Failed to restart session ${folder}:`, err);
            });
        }
    }
}

function getConfig(sessionId: string) {
  const configPath = path.join(process.cwd(), `bot-config-${sessionId}.json`);
  if (fs.existsSync(configPath)) {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const arrays = ['antilink', 'antispam', 'antibot', 'antifake', 'antidelete', 'antiviewonce', 'autokick', 'onlyadmin', 'antimention', 'antitoxic', 'antiforward', 'antipicture', 'antivideo', 'antiaudio', 'antidocument', 'anticontact', 'antilocation', 'antipoll', 'welcome', 'nsfw', 'bannedUsers', 'bannedChats', 'premiumUsers', 'enabledWelcome', 'enabledGoodbye'];
    arrays.forEach(arr => {
        if (!cfg[arr]) cfg[arr] = [];
    });
    if (!cfg.language) cfg.language = 'en';
    if (typeof cfg.autoreact === 'undefined') cfg.autoreact = false;
    if (typeof cfg.aisupport === 'undefined') cfg.aisupport = false;
    if (typeof cfg.autostatus === 'undefined') cfg.autostatus = false;
    if (typeof cfg.autostatusEmoji === 'undefined') cfg.autostatusEmoji = '🗽';
    return cfg;
  }
  return { prefix: '.', mode: 'public', language: 'en', autoreact: false, aisupport: false, autostatus: false, autostatusEmoji: '🗽', antilink: [], antispam: [], antibot: [], antifake: [], antidelete: [], antiviewonce: [], autokick: [], onlyadmin: [], antimention: [], antitoxic: [], antiforward: [], antipicture: [], antivideo: [], antiaudio: [], antidocument: [], anticontact: [], antilocation: [], antipoll: [], bannedUsers: [], bannedChats: [], premiumUsers: [], enabledWelcome: [], enabledGoodbye: [] };
}

function saveConfig(sessionId: string, config: any) {
  const configPath = path.join(process.cwd(), `bot-config-${sessionId}.json`);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

async function startBot(sessionId: string, phoneNumber?: string): Promise<string | null> {
    let session = sessions.get(sessionId);
    if (!session) {
        session = {
            id: sessionId,
            sock: null,
            status: 'disconnected',
            phoneNumber,
            isReconnecting: false,
            reconnectInterval: null,
            decryptionErrors: 0,
            lastHeartbeat: Date.now(),
            lastAttempt: Date.now()
        };
        sessions.set(sessionId, session);
    }

    if (session.status === 'connecting' || session.status === 'connected') return null;
    session.status = 'connecting';
    session.lastAttempt = Date.now();

    const { state, saveCreds } = await useMultiFileAuthState(`sessions/${sessionId}`);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }) as any,
        printQRInTerminal: false,
        auth: state,
        browser: ['Ubuntu', 'Chrome', '20.0.0'],
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        shouldSyncHistoryMessage: () => false,
    });
    session.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            session!.status = 'disconnected';
            const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
            const error = lastDisconnect?.error;
            const errorMessage = error?.message || '';
            const errorStack = error?.stack || '';
            const fullError = (errorMessage + ' ' + errorStack).toLowerCase();
            
            const isLoggedOut = statusCode === DisconnectReason.loggedOut;
            const isCorrupted = fullError.includes('bad mac') || 
                             fullError.includes('decryption') || 
                             fullError.includes('failed to decrypt') ||
                             fullError.includes('messagecountererror') ||
                             fullError.includes('key used already') ||
                             statusCode === 411; 

            if (isLoggedOut || isCorrupted) {
                console.log(`Session ${sessionId} logged out or corrupted (${isCorrupted ? 'Corruption Error' : 'Logged Out'}). Clearing session data...`);
                try {
                    const sessionPath = path.join(process.cwd(), `sessions/${sessionId}`);
                    if (fs.existsSync(sessionPath)) {
                        // Try to close any open files before deleting
                        try {
                            if (session.sock) {
                                session.sock.logout().catch(() => {});
                                session.sock.end();
                            }
                        } catch (e) {}
                        
                        fs.rmSync(sessionPath, { recursive: true, force: true });
                        console.log(`Successfully cleared session data for ${sessionId}`);
                    }
                } catch (e) {
                    console.error(`Failed to delete session folder for ${sessionId}:`, e);
                }
                sessions.delete(sessionId);
                session.status = 'disconnected';
            } else if (statusCode === DisconnectReason.restartRequired || statusCode === DisconnectReason.connectionLost) {
                console.log(`Session ${sessionId} requires restart. Reconnecting...`);
                setTimeout(() => startBot(sessionId), 2000);
            } else {
                session!.isReconnecting = true;
                console.log(`Session ${sessionId} disconnected (${statusCode}). Reconnecting in 5s...`);
                setTimeout(() => startBot(sessionId), 5000);
            }
        } else if (connection === 'open') {
            session!.status = 'connected';
            session!.lastHeartbeat = Date.now();
            console.log(`[${sessionId}] Session connected to WhatsApp!`);
            session!.isReconnecting = false;
            session!.decryptionErrors = 0;
            
            // Auto-subscribe to channel
            try {
                await sock.newsletterFollow('120363283626456789@newsletter');
            } catch (e: any) {
                console.log('Failed to auto-follow newsletter:', e.message);
            }

            // Mark as online
            try {
                await sock.sendPresenceUpdate('available');
            } catch (e) {}
            
            // Wait a bit for the connection to fully synchronize before sending the welcome message
            setTimeout(async () => {
                if (session!.status !== 'connected' || !sock.user) return;
                try {
                    const id = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                    await sock.sendMessage(id, { 
                        text: '🌸🚀 *VORTEX-MD CONNECTED SUCCESSFULLY* ✅\n\nConnection to WhatsApp established.⚡ All systems are now online and operational.\n\nType `.menu` to see available commands.' 
                    });
                } catch (err) {
                    if (err instanceof Error && !err.message.includes('Connection Closed')) {
                        console.error('Failed to send welcome message:', err);
                    }
                }
            }, 5000);
        }
    });

    if (!session.reconnectInterval) {
        session.reconnectInterval = setInterval(async () => {
            const now = Date.now();
            const isStuck = session!.status === 'connecting' && session!.lastAttempt && (now - session!.lastAttempt > 10 * 60 * 1000);
            const isDisconnected = session!.status === 'disconnected';
            const isInactive = session!.status === 'connected' && session!.lastHeartbeat && (now - session!.lastHeartbeat > 30 * 60 * 1000);

            if (isDisconnected || isStuck || isInactive) {
                console.log(`[Stability] Session ${sessionId} check: Disconnected=${isDisconnected}, Stuck=${isStuck}, Inactive=${isInactive}. Restarting...`);
                session!.isReconnecting = true;
                session!.status = 'disconnected'; // Force disconnected state for startBot
                if (session!.sock) {
                    try { session!.sock.end(); } catch (e) {}
                }
                startBot(sessionId);
            } else if (session!.status === 'connected' && session!.sock) {
                // Heartbeat to stay online
                try {
                    await session!.sock.sendPresenceUpdate('available');
                } catch (e) {}
            }
        }, 5 * 60 * 1000); // 5 minutes
    }

    sock.ev.on('group-participants.update', async (update) => {
        const { id, participants, action } = update;
        const config = getConfig(sessionId);
        
        // Disabled by default unless explicitly enabled
        const isWelcomeEnabled = config.enabledWelcome?.includes(id);
        const isGoodbyeEnabled = config.enabledGoodbye?.includes(id);

        if ((action === 'add' && isWelcomeEnabled) || (action === 'remove' && isGoodbyeEnabled)) {
            try {
                // Check if socket is still connected
                if (!sock || session.status !== 'connected') return;

                const groupMetadata = await sock.groupMetadata(id).catch(() => null);
                if (!groupMetadata) return;

                for (const p of participants) {
                    const participant = typeof p === 'string' ? p : (p as any).id || p;
                    if (!participant || typeof participant !== 'string') continue;
                    
                    let ppUrl = 'https://i.imgur.com/vH1qQv7.jpg'; // Default PP
                    try {
                        ppUrl = await sock.profilePictureUrl(participant, 'image').catch(() => 'https://i.imgur.com/vH1qQv7.jpg');
                    } catch (e) {}

                    const now = new Date();
                    const dateStr = now.toLocaleDateString('fr-FR');
                    const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                    const memberCount = groupMetadata.participants?.length || 0;

                    let caption = '';
                    if (action === 'add') {
                        caption = `╭────── ★ ᴠᴏʀᴛᴇx ★ ───────╮
𝗰𝗰 @${participant.split('@')[0]} 👏
𝗕𝗶𝗲𝗻𝘃𝗲𝗻𝘂𝗲 𝗱𝗮𝗻𝘀 𝗹𝗲 𝗴𝗿𝗼𝘂𝗽𝗲
@${groupMetadata.subject || 'Groupe'} ˃͈◡˂͈🫀
╰─➤ 🕯𝗠𝗲𝗺𝗯𝗿𝗲𝘀 𝗻° ${memberCount}🍬

➼ 🌮${dateStr} ${timeStr} 🩷


${groupMetadata.desc || 'Pas de description'}

╰───────────────────────╯
By Sam`;
                    } else {
                        caption = `╭────── ★ ᴠᴏʀᴛᴇx ★ ───────╮
𝗚𝗼𝗼𝗱𝗯𝘆𝗲 @${participant.split('@')[0]} 👋
𝗔 𝗾𝘂𝗶𝘁𝘁𝗲́ 𝗹𝗲 𝗴𝗿𝗼𝘂𝗽𝗲
@${groupMetadata.subject || 'Groupe'} ˃͈◡˂͈💔
╰─➤ 🕯𝗠𝗲𝗺𝗯𝗿𝗲𝘀 𝗿𝗲𝘀𝘁𝗮𝗻𝘁𝘀 : ${memberCount}🍬

➼ 🌮${dateStr} ${timeStr} 🩷

╰───────────────────────╯
By Sam`;
                    }

                    if (sock && session.status === 'connected') {
                        await sock.sendMessage(id, {
                            image: { url: ppUrl },
                            caption: caption,
                            mentions: [participant],
                            contextInfo: {
                                forwardingScore: 999,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid: '120363406104843715@newsletter',
                                    newsletterName: 'VORTEX-MD CHANNEL',
                                    serverMessageId: 100
                                }
                            }
                        }).catch(err => {
                            const msg = err?.message || String(err);
                            if (msg.includes('Connection Closed') || msg.includes('not connected')) {
                                return;
                            }
                            console.error('Failed to send welcome/goodbye message:', msg);
                        });
                    }
                }
            } catch (err: any) {
                const msg = err?.message || String(err);
                if (!msg.includes('Connection Closed') && !msg.includes('not connected')) {
                    console.error('Error in welcome/goodbye message handler:', msg);
                }
            }
        }
    });

    sock.ev.on('messages.upsert', async (m: any) => {
        try {
            let msg = m.messages[0];
            if (!msg.message) return;

            // Unwrap message
            if (msg.message.ephemeralMessage) {
                msg.message = msg.message.ephemeralMessage.message;
            } else if (msg.message.viewOnceMessage) {
                msg.message = msg.message.viewOnceMessage.message;
            } else if (msg.message.viewOnceMessageV2) {
                msg.message = msg.message.viewOnceMessageV2.message;
            } else if (msg.message.viewOnceMessageV2Extension) {
                msg.message = msg.message.viewOnceMessageV2Extension.message;
            } else if (msg.message.documentWithCaptionMessage) {
                msg.message = msg.message.documentWithCaptionMessage.message;
            }

            const config = getConfig(sessionId);
            console.log(`[${sessionId}] Processing message with prefix: ${config.prefix}`);
            const text = msg.message.conversation || 
                         msg.message.extendedTextMessage?.text || 
                         msg.message.imageMessage?.caption || 
                         msg.message.videoMessage?.caption || 
                         msg.message.documentMessage?.caption ||
                         msg.message.documentWithCaptionMessage?.message?.documentMessage?.caption ||
                         '';
            
            if (text) {
                console.log(`[${sessionId}] New message from ${msg.key.remoteJid}: ${text.substring(0, 50)}`);
            }
            
            if (!msg.key.remoteJid) return;
            
            const isFromMe = msg.key.fromMe;
        
        // Update heartbeat on every message
        if (session) {
            session.lastHeartbeat = Date.now();
        }
        
        // Helper to send translated messages
        const reply = async (text: string, quoted: any = null, options: any = {}) => {
            let finalMsg = text;
            if (config.language && config.language !== 'fr') {
                try {
                    const res = await axios.get(`https://api.popcat.xyz/translate?to=${config.language}&text=${encodeURIComponent(text)}`);
                    if (res.data && res.data.translated) {
                        finalMsg = res.data.translated;
                    }
                } catch (e) {
                    console.error('Translation failed:', e);
                }
            }
            if (quoted) {
                return await sock.sendMessage(msg.key.remoteJid, { text: finalMsg, ...options }, { quoted });
            } else {
                return await sock.sendMessage(msg.key.remoteJid, { text: finalMsg, ...options });
            }
        };

        // Auto-react to statuses
        if (msg.key.remoteJid === 'status@broadcast' && !isFromMe) {
            if (config.autostatus) {
                try {
                    await sock.readMessages([msg.key]);
                    const emoji = config.autostatusEmoji || '🗽';
                    await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });
                } catch (err) {
                    console.error('Failed to auto-react to status:', err);
                }
            }
            return; // Don't process commands on statuses
        }

        const isGroup = msg.key.remoteJid?.endsWith('@g.us');
        const sender = msg.key.participant || msg.key.remoteJid;
        if (!sender || typeof sender !== 'string') return;

        // AFK Check: If sender was AFK, remove them
        if (afkUsers[sender]) {
            const afkData = afkUsers[sender];
            const duration = formatUptime(Date.now() - afkData.time);
            delete afkUsers[sender];
            saveAfk();
            await sock.sendMessage(msg.key.remoteJid, { 
                text: `👋 @${sender.split('@')[0]} n'est plus AFK.\n*Durée:* ${duration}`, 
                mentions: [sender] 
            }, { quoted: msg });
        }

        // AFK Check: If someone tags an AFK user
        const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        for (let jid of mentionedJids) {
            if (afkUsers[jid]) {
                const afkData = afkUsers[jid];
                const duration = formatUptime(Date.now() - afkData.time);
                await sock.sendMessage(msg.key.remoteJid, { 
                    text: `⚠️ @${jid.split('@')[0]} est AFK.\n*Raison:* ${afkData.reason}\n*Depuis:* ${duration}`, 
                    mentions: [jid] 
                }, { quoted: msg });
            }
        }
        
        // Auto-react feature
        if (config.autoreact && !isFromMe && msg.key.remoteJid !== 'status@broadcast') {
            const emojis = ['❤️', '😂', '🔥', '👍', '🙌', '👀', '💯', '✨', '🎉', '🤔', '😎', '👌', '🙏', '💡', '🌟'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            try {
                await sock.sendMessage(msg.key.remoteJid, { react: { text: randomEmoji, key: msg.key } });
            } catch (e) {
                console.error('Failed to autoreact:', e);
            }
        }

        // AI Support feature (private messages only, when not a command)
        if (config.aisupport && !isGroup && !text.startsWith(config.prefix) && text.trim().length > 0) {
            // Allow testing from the owner's own number, but prevent infinite loops by checking if the message is from the AI
            const isSelfChat = msg.key.remoteJid === sock.user.id.split(':')[0] + '@s.whatsapp.net';
            
            if (!isFromMe || (isSelfChat && !text.includes('🤖'))) {
                try {
                    const ai = getAi();
                    const response = await ai.models.generateContent({
                        model: 'gemini-3-flash-preview',
                        contents: text,
                        config: {
                            systemInstruction: "Tu es Samy Charles, le créateur de Vortex-MD. Réponds de manière naturelle, amicale et un peu cool, comme si tu parlais à un ami sur WhatsApp. Ne dis pas que tu es une IA. Ajoute parfois un petit emoji discret."
                        }
                    });
                    if (response.text) {
                        const replyText = isSelfChat ? `🤖 ${response.text}` : response.text;
                        await reply(replyText, msg);
                    }
                } catch (e) {
                    console.error('AI Support Error:', e);
                }
            }
        }

        if (config.mode === 'private' && !isFromMe) {
            return;
        }

        // Check if user or chat is banned
        if (!isFromMe) {
            if (config.bannedUsers?.includes(sender)) return;
            if (config.bannedChats?.includes(msg.key.remoteJid)) return;
        }

        let isAdmin = false;
        let isBotAdmin = false;
        if (isGroup) {
            try {
                const groupMetadata = await sock.groupMetadata(msg.key.remoteJid);
                const botId = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
                const senderId = jidNormalizedUser(sender);
                
                isAdmin = !!groupMetadata.participants.find((p: any) => jidNormalizedUser(p.id) === senderId)?.admin;
                if (botId) {
                    const botParticipant = groupMetadata.participants.find((p: any) => jidNormalizedUser(p.id) === botId);
                    isBotAdmin = !!botParticipant?.admin || !!botParticipant?.isSuperAdmin;
                }
                
                // Debug log for antilink issues
                if (config.antilink?.includes(msg.key.remoteJid) && !isAdmin) {
                    console.log(`[ANTILINK DEBUG] Group: ${msg.key.remoteJid}, Bot ID: ${botId}, isBotAdmin: ${isBotAdmin}`);
                }
            } catch (e) {}
        }

        // --- SECURITY INTERCEPTORS ---
        if (isGroup && !isFromMe) {
            // 2. Anti Link & Auto Kick (Check this even if bot is not admin, to warn)
            if (config.antilink?.includes(msg.key.remoteJid) && !isAdmin) {
                const linkRegex = /((https?:\/\/)?(www\.)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/[^\s]*)?|wa\.me\/[^\s]+|chat\.whatsapp\.com\/[^\s]+|t\.me\/[^\s]+)/gi;
                if (linkRegex.test(text)) {
                    if (!isBotAdmin) {
                        await reply(`⚠️ *ANTILINK:* J'ai détecté un lien, mais je ne peux pas le supprimer car le compte lié au bot n'est pas *ADMIN* du groupe.`, null, { mentions: [sender] });
                        return;
                    }

                    try {
                        await sock.sendMessage(msg.key.remoteJid, { delete: msg.key });
                    } catch (e) {
                        console.error('Failed to delete link message:', e);
                    }
                    
                    const warningKey = `${msg.key.remoteJid}_${sender}`;
                    const currentWarnings = (userWarnings.get(warningKey) || 0) + 1;
                    userWarnings.set(warningKey, currentWarnings);

                    if (currentWarnings >= 3 || config.autokick?.includes(msg.key.remoteJid)) {
                        try {
                            await sock.groupParticipantsUpdate(msg.key.remoteJid, [sender], 'remove');
                            await reply(`⚠️ @${sender.split('@')[0]} a été banni pour avoir envoyé des liens (3/3 avertissements) !`, null, { mentions: [sender] });
                            userWarnings.delete(warningKey);
                        } catch (e) {
                            await reply(`❌ Impossible de bannir @${sender.split('@')[0]}. Assurez-vous que je suis admin.`, null, { mentions: [sender] });
                        }
                    } else {
                        await reply(`⚠️ @${sender.split('@')[0]}, les liens sont interdits ! Avertissement ${currentWarnings}/3. Au 3ème, tu seras banni.`, null, { mentions: [sender] });
                    }
                    return;
                }
            }

            if (isBotAdmin && !isAdmin) {
                    // 0. Anti Spam
                    if (config.antispam?.includes(msg.key.remoteJid)) {
                        const now = Date.now();
                        if (!global.spamTracker) global.spamTracker = {};
                        if (!global.spamTracker[sender]) global.spamTracker[sender] = [];
                        global.spamTracker[sender].push(now);
                        global.spamTracker[sender] = global.spamTracker[sender].filter((t: number) => now - t < 10000); // messages in last 10 seconds
                        
                        if (global.spamTracker[sender].length > 5) { // 5 messages in 10 seconds
                            await sock.sendMessage(msg.key.remoteJid, { delete: msg.key });
                            await sock.groupParticipantsUpdate(msg.key.remoteJid, [sender], 'remove');
                            await reply(`⚠️ @${sender.split('@')[0]} was kicked for spamming!`, null, { mentions: [sender] });
                            return;
                        }
                    }

                    // 1. Only Admin
                    if (config.onlyadmin?.includes(msg.key.remoteJid)) {
                        await sock.sendMessage(msg.key.remoteJid, { delete: msg.key });
                        return;
                    }

                    // 3. Anti Mention (Delete if they tag anyone or @all)
                    const mentionedJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    if (config.antimention?.includes(msg.key.remoteJid) && (mentionedJid.length > 0 || text.includes('@all') || text.includes('@everyone'))) {
                        try {
                            await sock.sendMessage(msg.key.remoteJid, { delete: msg.key });
                        } catch (e) {}
                        await reply(`⚠️ @${sender.split('@')[0]}, mentions are disabled in this group!`, null, { mentions: [sender] });
                        return;
                    }

                    // 4. Anti Bot (Kick if ID looks like a bot)
                    if (config.antibot?.includes(msg.key.remoteJid) && (msg.key.id.startsWith('BAE5') || msg.key.id.length === 22 || msg.key.id.length > 30)) {
                        try {
                            await sock.sendMessage(msg.key.remoteJid, { delete: msg.key });
                            await sock.groupParticipantsUpdate(msg.key.remoteJid, [sender], 'remove');
                        } catch (e) {}
                        return;
                    }

                    // 5. Anti Fake (Kick virtual/foreign numbers)
                    if (config.antifake?.includes(msg.key.remoteJid)) {
                        const fakePrefixes = ['1', '44', '48', '7', '92', '212', '94'];
                        const senderPrefix = sender.split('@')[0].substring(0, 2);
                        const senderPrefix1 = sender.split('@')[0].substring(0, 1);
                        if (fakePrefixes.includes(senderPrefix) || fakePrefixes.includes(senderPrefix1)) {
                            try {
                                await sock.groupParticipantsUpdate(msg.key.remoteJid, [sender], 'remove');
                            } catch (e) {}
                            return;
                        }
                    }

                    // 6. Anti Forward
                    if (config.antiforward?.includes(msg.key.remoteJid) && msg.message?.extendedTextMessage?.contextInfo?.isForwarded) {
                        try {
                            await sock.sendMessage(msg.key.remoteJid, { delete: msg.key });
                        } catch (e) {}
                        return;
                    }

                    // 7. Anti Media/Types
                    const msgType = Object.keys(msg.message)[0];
                    if (config.antipicture?.includes(msg.key.remoteJid) && msgType === 'imageMessage') { try { await sock.sendMessage(msg.key.remoteJid, { delete: msg.key }); } catch (e) {} return; }
                    if (config.antivideo?.includes(msg.key.remoteJid) && msgType === 'videoMessage') { try { await sock.sendMessage(msg.key.remoteJid, { delete: msg.key }); } catch (e) {} return; }
                    if (config.antiaudio?.includes(msg.key.remoteJid) && msgType === 'audioMessage') { try { await sock.sendMessage(msg.key.remoteJid, { delete: msg.key }); } catch (e) {} return; }
                    if (config.antidocument?.includes(msg.key.remoteJid) && msgType === 'documentMessage') { try { await sock.sendMessage(msg.key.remoteJid, { delete: msg.key }); } catch (e) {} return; }
                    if (config.anticontact?.includes(msg.key.remoteJid) && msgType === 'contactMessage') { try { await sock.sendMessage(msg.key.remoteJid, { delete: msg.key }); } catch (e) {} return; }
                    if (config.antilocation?.includes(msg.key.remoteJid) && msgType === 'locationMessage') { try { await sock.sendMessage(msg.key.remoteJid, { delete: msg.key }); } catch (e) {} return; }
                    if (config.antipoll?.includes(msg.key.remoteJid) && msgType === 'pollCreationMessage') { try { await sock.sendMessage(msg.key.remoteJid, { delete: msg.key }); } catch (e) {} return; }
                }
        }
        // --- END SECURITY INTERCEPTORS ---

        if (text.startsWith(config.prefix)) {
            const args = text.slice(config.prefix.length).trim().split(/ +/);
            const cmd = args.shift()?.toLowerCase();
            console.log(`[${sessionId}] Command detected: ${cmd} from ${sender}`);
            const username = msg.pushName || 'User';
            const isGroup = msg.key.remoteJid?.endsWith('@g.us');
            
            const mentionedJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const quotedMessage = msg.message?.extendedTextMessage?.contextInfo?.participant;
            if (quotedMessage && !mentionedJid.includes(quotedMessage)) {
                mentionedJid.push(quotedMessage);
            }

            if (cmd === 'public') {
                if (!isFromMe) return await reply('❌ Seul le propriétaire du bot peut utiliser cette commande.', msg);
                config.mode = 'public';
                saveConfig(sessionId, config);
                await reply('✅ Le bot est maintenant en mode PUBLIC. Tout le monde peut utiliser les commandes.', msg);
            } else if (cmd === 'private') {
                if (!isFromMe) return await reply('❌ Seul le propriétaire du bot peut utiliser cette commande.', msg);
                config.mode = 'private';
                saveConfig(sessionId, config);
                await reply('✅ Le bot est maintenant en mode PRIVÉ. Seul le propriétaire peut utiliser les commandes.', msg);
            } else if (cmd === 'setmode') {
                if (!isFromMe) return await reply('❌ Seul le propriétaire du bot peut utiliser cette commande.', msg);
                if (args.length === 0) return await reply(`❌ Usage: ${config.prefix}setmode <public/private>`, msg);
                const mode = args[0].toLowerCase();
                if (mode !== 'public' && mode !== 'private') return await reply('❌ Mode invalide. Utilisez "public" ou "private".', msg);
                config.mode = mode;
                saveConfig(sessionId, config);
                await reply(`✅ Le bot est maintenant en mode ${mode.toUpperCase()}.`, msg);
            } else if (cmd === 'setprefix') {
                if (!isFromMe) return await reply('❌ Seul le propriétaire du bot peut utiliser cette commande.', msg);
                if (args.length === 0) return await reply(`❌ Usage: ${config.prefix}setprefix <nouveau_prefix>`, msg);
                config.prefix = args[0];
                saveConfig(sessionId, config);
                await reply(`✅ Le préfixe a été changé en: ${config.prefix}`, msg);
            } else if (cmd === 'ban') {
                if (!isFromMe) return await reply('❌ Seul le propriétaire du bot peut utiliser cette commande.', msg);
                let user = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message.extendedTextMessage?.contextInfo?.participant || args[0];
                if (!user) return await reply('❌ Veuillez mentionner un utilisateur ou fournir son numéro.', msg);
                if (!user.endsWith('@s.whatsapp.net')) user = user.replace(/\D/g, '') + '@s.whatsapp.net';
                if (!config.bannedUsers.includes(user)) {
                    config.bannedUsers.push(user);
                    saveConfig(sessionId, config);
                    await reply(`✅ @${user.split('@')[0]} a été banni du bot.`, msg, { mentions: [user] });
                } else {
                    await reply(`❌ Cet utilisateur est déjà banni.`, msg);
                }
            } else if (cmd === 'unban') {
                if (!isFromMe) return await reply('❌ Seul le propriétaire du bot peut utiliser cette commande.', msg);
                let user = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message.extendedTextMessage?.contextInfo?.participant || args[0];
                if (!user) return await reply('❌ Veuillez mentionner un utilisateur ou fournir son numéro.', msg);
                if (!user.endsWith('@s.whatsapp.net')) user = user.replace(/\D/g, '') + '@s.whatsapp.net';
                if (config.bannedUsers.includes(user)) {
                    config.bannedUsers = config.bannedUsers.filter((u: string) => u !== user);
                    saveConfig(sessionId, config);
                    await reply(`✅ @${user.split('@')[0]} a été débanni du bot.`, msg, { mentions: [user] });
                } else {
                    await reply(`❌ Cet utilisateur n'est pas banni.`, msg);
                }
            } else if (cmd === 'block') {
                if (!isFromMe) return await reply('❌ Seul le propriétaire du bot peut utiliser cette commande.', msg);
                let user = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message.extendedTextMessage?.contextInfo?.participant || args[0];
                if (!user) return await reply('❌ Veuillez mentionner un utilisateur ou fournir son numéro.', msg);
                if (!user.endsWith('@s.whatsapp.net')) user = user.replace(/\D/g, '') + '@s.whatsapp.net';
                await sock.updateBlockStatus(user, "block");
                await reply(`✅ @${user.split('@')[0]} a été bloqué.`, msg, { mentions: [user] });
            } else if (cmd === 'unblock') {
                if (!isFromMe) return await reply('❌ Seul le propriétaire du bot peut utiliser cette commande.', msg);
                let user = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message.extendedTextMessage?.contextInfo?.participant || args[0];
                if (!user) return await reply('❌ Veuillez mentionner un utilisateur ou fournir son numéro.', msg);
                if (!user.endsWith('@s.whatsapp.net')) user = user.replace(/\D/g, '') + '@s.whatsapp.net';
                await sock.updateBlockStatus(user, "unblock");
                await reply(`✅ @${user.split('@')[0]} a été débloqué.`, msg, { mentions: [user] });
            } else if (cmd === 'banchat') {
                if (!isFromMe) return await reply('❌ Seul le propriétaire du bot peut utiliser cette commande.', msg);
                const chat = msg.key.remoteJid;
                if (!config.bannedChats.includes(chat)) {
                    config.bannedChats.push(chat);
                    saveConfig(sessionId, config);
                    await reply(`✅ Ce chat a été banni du bot.`, msg);
                } else {
                    await reply(`❌ Ce chat est déjà banni.`, msg);
                }
            } else if (cmd === 'unbanchat') {
                if (!isFromMe) return await reply('❌ Seul le propriétaire du bot peut utiliser cette commande.', msg);
                const chat = msg.key.remoteJid;
                if (config.bannedChats.includes(chat)) {
                    config.bannedChats = config.bannedChats.filter((c: string) => c !== chat);
                    saveConfig(sessionId, config);
                    await reply(`✅ Ce chat a été débanni du bot.`, msg);
                } else {
                    await reply(`❌ Ce chat n'est pas banni.`, msg);
                }
            } else if (cmd === 'addprem') {
                if (!isFromMe) return await reply('❌ Seul le propriétaire du bot peut utiliser cette commande.', msg);
                let user = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message.extendedTextMessage?.contextInfo?.participant || args[0];
                if (!user) return await reply('❌ Veuillez mentionner un utilisateur ou fournir son numéro.', msg);
                if (!user.endsWith('@s.whatsapp.net')) user = user.replace(/\D/g, '') + '@s.whatsapp.net';
                if (!config.premiumUsers.includes(user)) {
                    config.premiumUsers.push(user);
                    saveConfig(sessionId, config);
                    await reply(`✅ @${user.split('@')[0]} est maintenant un utilisateur PREMIUM.`, msg, { mentions: [user] });
                } else {
                    await reply(`❌ Cet utilisateur est déjà PREMIUM.`, msg);
                }
            } else if (cmd === 'delprem') {
                if (!isFromMe) return await reply('❌ Seul le propriétaire du bot peut utiliser cette commande.', msg);
                let user = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || msg.message.extendedTextMessage?.contextInfo?.participant || args[0];
                if (!user) return await reply('❌ Veuillez mentionner un utilisateur ou fournir son numéro.', msg);
                if (!user.endsWith('@s.whatsapp.net')) user = user.replace(/\D/g, '') + '@s.whatsapp.net';
                if (config.premiumUsers.includes(user)) {
                    config.premiumUsers = config.premiumUsers.filter((u: string) => u !== user);
                    saveConfig(sessionId, config);
                    await reply(`✅ @${user.split('@')[0]} n'est plus un utilisateur PREMIUM.`, msg, { mentions: [user] });
                } else {
                    await reply(`❌ Cet utilisateur n'est pas PREMIUM.`, msg);
                }
            } else if (cmd === 'listprem') {
                if (!isFromMe) return await reply('❌ Seul le propriétaire du bot peut utiliser cette commande.', msg);
                if (config.premiumUsers.length === 0) return await reply('❌ Aucun utilisateur PREMIUM.', msg);
                let text = '💎 *LISTE DES UTILISATEURS PREMIUM*\n\n';
                config.premiumUsers.forEach((u: string, i: number) => {
                    text += `${i + 1}. @${u.split('@')[0]}\n`;
                });
                await reply(text, msg, { mentions: config.premiumUsers });
            } else if (cmd === 'restart') {
                if (!isFromMe) return await reply('❌ Seul le propriétaire du bot peut utiliser cette commande.', msg);
                await reply('🔄 Redémarrage de la session en cours...', msg);
                const session = sessions.get(sessionId);
                if (session && session.sock) {
                    session.sock.logout(); // This will trigger connection.update 'close' and then startBot
                }
            } else if (cmd === 'join') {
                if (!isFromMe) return await reply('❌ Seul le propriétaire du bot peut utiliser cette commande.', msg);
                if (args.length === 0) return await reply(`❌ Usage: ${config.prefix}join <lien_groupe>`, msg);
                const link = args[0];
                const code = link.split('https://chat.whatsapp.com/')[1];
                if (!code) return await reply('❌ Lien de groupe invalide.', msg);
                try {
                    await sock.groupAcceptInvite(code);
                    await reply('✅ Groupe rejoint avec succès !', msg);
                } catch (e) {
                    await reply('❌ Impossible de rejoindre le groupe. Vérifiez le lien.', msg);
                }
            } else if (cmd === 'clear') {
                if (!isFromMe) return await reply('❌ Seul le propriétaire du bot peut utiliser cette commande.', msg);
                await reply('🧹 Nettoyage du chat...', msg);
                try {
                    await sock.chatModify({ delete: true, lastMessages: [{ key: msg.key, messageTimestamp: msg.messageTimestamp }] }, msg.key.remoteJid);
                } catch (e) {
                    // Fallback or ignore
                }
            } else if (cmd === 'broadcast' || cmd === 'bc') {
                if (!isFromMe) return await reply('❌ Seul le propriétaire du bot peut utiliser cette commande.', msg);
                if (args.length === 0) return await reply(`❌ Usage: ${config.prefix}bc <message>`, msg);
                const bcMsg = args.join(' ');
                await reply('⏳ Envoi du broadcast en cours...', msg);
                
                try {
                    // Get all chats
                    const chats = await sock.groupFetchAllParticipating();
                    const groupIds = Object.keys(chats);
                    let success = 0;
                    for (const id of groupIds) {
                        try {
                            await sock.sendMessage(id, { text: `📢 *BROADCAST*\n\n${bcMsg}` });
                            success++;
                            await new Promise(resolve => setTimeout(resolve, 500)); // Rate limiting
                        } catch (e) {
                            console.error(`Failed to broadcast to ${id}:`, e);
                        }
                    }
                    await reply(`✅ Broadcast envoyé à ${success} groupes.`, msg);
                } catch (e) {
                    await reply('❌ Erreur lors du broadcast.', msg);
                }
            } else if (cmd === 'pair') {
                if (args.length === 0) return await reply(`❌ Usage: ${config.prefix}pair <numéro>`, msg);
                const phone = args[0].replace(/\D/g, '');
                if (phone.length < 10) return await reply('❌ Numéro invalide.', msg);
                
                await reply('⏳ Génération du code de couplage en cours...', msg);
                try {
                    const code = await startBot(phone, phone);
                    if (code) {
                        await reply(`✅ Code de couplage pour *${phone}* :\n\n*${code}*\n\nEntrez ce code dans WhatsApp sur le téléphone cible.`, msg);
                    } else {
                        await reply('❌ Le bot est déjà connecté ou en cours de connexion pour ce numéro.', msg);
                    }
                } catch (e: any) {
                    await reply(`❌ Erreur: ${e.message}`, msg);
                }
            } else if (cmd === 'public') {
                if (!isFromMe) return await reply('❌ Seul le propriétaire du bot peut utiliser cette commande.', msg);
                config.mode = 'public';
                saveConfig(sessionId, config);
                await reply('🔓 Le bot est maintenant en mode *PUBLIC*. Tout le monde peut l\'utiliser.', msg);
            } else if (cmd === 'private') {
                if (!isFromMe) return await reply('❌ Seul le propriétaire du bot peut utiliser cette commande.', msg);
                config.mode = 'private';
                saveConfig(sessionId, config);
                await reply('🔒 Le bot est maintenant en mode *PRIVÉ*. Seul le propriétaire peut l\'utiliser.', msg);
            } else if (cmd === 'nsfw') {
                const isOwner = isFromMe;
                let isAdmin = false;
                
                if (isGroup) {
                    try {
                        const groupMetadata = await sock.groupMetadata(msg.key.remoteJid);
                        isAdmin = !!groupMetadata.participants.find((p: any) => p.id === (msg.key.participant || msg.key.remoteJid))?.admin;
                    } catch (e) {
                        isAdmin = false;
                    }
                } else {
                    isAdmin = true; // In private, the user is their own admin
                }

                if (!isAdmin && !isOwner) return await reply('❌ Seul un administrateur peut activer/désactiver le mode NSFW.', msg);
                
                const index = config.nsfw.indexOf(msg.key.remoteJid);
                if (index > -1) {
                    config.nsfw.splice(index, 1);
                    saveConfig(sessionId, config);
                    await reply(`🔞 Mode NSFW désactivé pour ce ${isGroup ? 'groupe' : 'chat privé'}.`, msg);
                } else {
                    config.nsfw.push(msg.key.remoteJid);
                    saveConfig(sessionId, config);
                    await reply(`🔞 Mode NSFW activé pour ce ${isGroup ? 'groupe' : 'chat privé'}. Utilisez les commandes NSFW avec précaution.`, msg);
                }
            } else if (['waifu', 'neko', 'shinobu', 'megumin', 'bully', 'cuddle', 'cry', 'hug', 'awoo', 'kiss', 'lick', 'pat', 'smug', 'bonk', 'yeet', 'blush', 'smile', 'wave', 'highfive', 'handhold', 'nom', 'bite', 'glomp', 'slap', 'kill', 'happy', 'wink', 'poke', 'dance', 'cringe', 'hentai'].includes(cmd || '')) {
                if (cmd === 'hentai') {
                    if (!config.nsfw.includes(msg.key.remoteJid)) {
                        return await reply(`❌ Le mode NSFW est désactivé. Utilisez la commande \`${config.prefix}nsfw\` pour l'activer.`, msg);
                    }
                }
                
                await sock.sendMessage(msg.key.remoteJid, { react: { text: '🌸', key: msg.key } });
                try {
                    const type = cmd === 'hentai' ? 'nsfw' : 'sfw';
                    const res = await axios.get(`https://api.waifu.pics/${type}/${cmd}`);
                    if (res.data && res.data.url) {
                        const caption = `🌸 *VORTEX-MD ANIME* 🌸\n\n*Action:* ${cmd?.toUpperCase()}`;
                        await sock.sendMessage(msg.key.remoteJid, { image: { url: res.data.url }, caption }, { quoted: msg });
                    }
                } catch (e) {
                    await reply('❌ Erreur lors de la récupération de l\'image anime.', msg);
                }
            } else if (cmd === 'anime') {
                if (args.length === 0) return await reply(`❌ Usage: ${config.prefix}anime <nom>`, msg);
                const query = args.join(' ');
                await sock.sendMessage(msg.key.remoteJid, { react: { text: '🔍', key: msg.key } });
                try {
                    const res = await axios.get(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=1`);
                    if (res.data.data && res.data.data.length > 0) {
                        const anime = res.data.data[0];
                        const caption = `🌸 *${anime.title}* 🌸\n\n` +
                                        `⭐ *Score:* ${anime.score || 'N/A'}\n` +
                                        `📅 *Episodes:* ${anime.episodes || 'N/A'}\n` +
                                        `🎭 *Genres:* ${anime.genres.map((g: any) => g.name).join(', ')}\n` +
                                        `📝 *Synopsis:* ${anime.synopsis?.substring(0, 300)}...`;
                        await sock.sendMessage(msg.key.remoteJid, { image: { url: anime.images.jpg.image_url }, caption }, { quoted: msg });
                    } else {
                        await reply('❌ Aucun anime trouvé.', msg);
                    }
                } catch (e) {
                    await reply('❌ Erreur lors de la recherche de l\'anime.', msg);
                }
            } else if (cmd === 'manga') {
                if (args.length === 0) return await reply(`❌ Usage: ${config.prefix}manga <nom>`, msg);
                const query = args.join(' ');
                await sock.sendMessage(msg.key.remoteJid, { react: { text: '🔍', key: msg.key } });
                try {
                    const res = await axios.get(`https://api.jikan.moe/v4/manga?q=${encodeURIComponent(query)}&limit=1`);
                    if (res.data.data && res.data.data.length > 0) {
                        const manga = res.data.data[0];
                        const caption = `📚 *${manga.title}* 📚\n\n` +
                                        `⭐ *Score:* ${manga.score || 'N/A'}\n` +
                                        `📅 *Volumes:* ${manga.volumes || 'N/A'}\n` +
                                        `🎭 *Genres:* ${manga.genres.map((g: any) => g.name).join(', ')}\n` +
                                        `📝 *Synopsis:* ${manga.synopsis?.substring(0, 300)}...`;
                        await sock.sendMessage(msg.key.remoteJid, { image: { url: manga.images.jpg.image_url }, caption }, { quoted: msg });
                    } else {
                        await reply('❌ Aucun manga trouvé.', msg);
                    }
                } catch (e) {
                    await reply('❌ Erreur lors de la recherche du manga.', msg);
                }
            } else if (cmd === 'ping' || cmd === 'speed') {
                const start = Date.now();
                const sentMsg = await reply('Pong ! 🏓', msg);
                const end = Date.now();
                const ping = end - start;
                setTimeout(async () => {
                    if (sentMsg) {
                        await reply(`Pong ! 🏓\n*VITESSE:* ${ping}ms`, null, { edit: sentMsg.key });
                    }
                }, 100);
            } else if (cmd === 'botstatus' || cmd === 'uptime') {
                const uptime = process.uptime();
                const hours = Math.floor(uptime / 3600);
                const minutes = Math.floor((uptime % 3600) / 60);
                const seconds = Math.floor(uptime % 60);
                
                const status = `╭─ ◈ *VORTEX-MD STATUS* ◈ ─╮\n│ 🚀 *Uptime:* ${hours}h ${minutes}m ${seconds}s\n│ 📊 *Sessions:* ${sessions.size}\n│ 🧠 *Memory:* ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB\n│ ⚡ *Mode:* ${config.mode.toUpperCase()}\n│ 🏛️ *Prefix:* ${config.prefix}\n╰────────────────╯`;
                await reply(status, msg);
            } else if (cmd === 'status' || cmd === 'statut') {
                const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!quoted) return await reply('❌ Répondez à un statut pour le télécharger.', msg);
                
                const type = Object.keys(quoted)[0];
                try {
                    if (type === 'imageMessage' || type === 'videoMessage') {
                        const media = quoted[type];
                        const buffer = await getMediaBuffer(media, type === 'imageMessage' ? 'image' : 'video');
                        const caption = media.caption || '';
                        
                        if (type === 'imageMessage') {
                            await sock.sendMessage(msg.key.remoteJid, { image: buffer, caption }, { quoted: msg });
                        } else {
                            await sock.sendMessage(msg.key.remoteJid, { video: buffer, caption }, { quoted: msg });
                        }
                    } else if (type === 'conversation' || type === 'extendedTextMessage') {
                        const text = quoted.conversation || quoted.extendedTextMessage?.text || '';
                        await reply(`📝 *Texte du Statut:* \n\n${text}`, msg);
                    } else {
                        await reply('❌ Ce type de message n\'est pas un statut téléchargeable.', msg);
                    }
                } catch (e) {
                    console.error('Error downloading status:', e);
                    await reply('❌ Erreur lors du téléchargement du statut.', msg);
                }
            } else if (cmd === 'menu' || cmd === 'help') {
                // Non-blocking reaction
                sock.sendMessage(msg.key.remoteJid, { react: { text: '🧑‍🔬', key: msg.key } }).catch(() => {});
                
                const menuText = generateMenu(username, config);
                
                // Send menu image + text and audio in parallel for maximum speed
                await Promise.all([
                    sock.sendMessage(msg.key.remoteJid, { 
                        image: { url: 'https://lieixmgdboiceopzksvu.supabase.co/storage/v1/object/public/hosted-files/k0u26rze-1773775925049.jpg' },
                        caption: menuText,
                        contextInfo: {
                            forwardingScore: 999,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: '120363406104843715@newsletter',
                                newsletterName: 'VORTEX-MD CHANNEL',
                                serverMessageId: 100
                            },
                            externalAdReply: {
                                title: "VORTEX-MD CHANNEL",
                                body: "Rejoins notre chaîne officielle",
                                thumbnailUrl: "https://lieixmgdboiceopzksvu.supabase.co/storage/v1/object/public/hosted-files/k0u26rze-1773775925049.jpg",
                                sourceUrl: "https://whatsapp.com/channel/0029Vb7AruX8fewz8dSRD340/100",
                                mediaType: 1,
                                renderLargerThumbnail: true
                            }
                        }
                    }, { quoted: msg }),
                    sock.sendMessage(msg.key.remoteJid, {
                        audio: { url: 'https://lieixmgdboiceopzksvu.supabase.co/storage/v1/object/public/hosted-files/4attg76f-1773777889376.mp3' },
                        mimetype: 'audio/mpeg',
                        ptt: false
                    }, { quoted: msg })
                ]);
            } else if (cmd === 'react') {
                if (!isFromMe) return await reply(`❌ Seul le propriétaire du bot peut utiliser cette commande.`, msg);
                if (args.length === 0) return await reply(`❌ Usage: ${config.prefix}react <lien de la publication>`, msg);
                
                const link = args[0];
                const match = link.match(/whatsapp\.com\/channel\/([a-zA-Z0-9_-]+)\/(\d+)/);
                if (!match) return await reply(`❌ Lien de publication invalide. Assurez-vous qu'il s'agit d'un lien de chaîne WhatsApp valide.`, msg);
                
                const inviteCode = match[1];
                const messageId = match[2];
                
                await reply(`⏳ Récupération des informations de la chaîne...`, msg);
                
                try {
                    const metadata = await sock.newsletterMetadata("invite", inviteCode);
                    const newsletterJid = metadata.id;
                    
                    await reply(`✅ Chaîne trouvée: ${metadata.name}\n🚀 Lancement des réactions avec tous les numéros connectés...`, msg);
                    
                    let successCount = 0;
                    const emojis = ['❤️', '👍', '🔥', '😂', '😮', '😢', '🎉', '💯', '🚀', '🙏'];
                    
                    for (const session of sessions.values()) {
                        if (session.status === 'connected' && session.sock) {
                            try {
                                const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                                await session.sock.sendMessage(newsletterJid, {
                                    react: {
                                        text: randomEmoji,
                                        key: { remoteJid: newsletterJid, id: messageId }
                                    }
                                });
                                successCount++;
                                await new Promise(resolve => setTimeout(resolve, 1000)); // Delay to avoid spam
                            } catch (e) {
                                console.error(`Failed to react with session ${session.id}:`, e);
                            }
                        }
                    }
                    
                    await reply(`✅ Terminé ! ${successCount} numéro(s) ont réagi à la publication.`, msg);
                } catch (e) {
                    await reply(`❌ Impossible de récupérer les informations de la chaîne. Assurez-vous que le lien est correct et que le bot y a accès.`, msg);
                }
            } else if (cmd === 'lang' || cmd === 'language') {
                const newLang = args[0]?.toLowerCase();
                if (newLang && newLang.length >= 2 && newLang.length <= 5) {
                    config.language = newLang;
                    saveConfig(sessionId, config);
                    await reply(`✅ Langue changée en ${newLang.toUpperCase()}. Le bot traduira désormais ses messages.`, msg);
                } else {
                    await reply(`❌ Langue invalide. Utilisez un code de langue valide (ex: fr, en, es, ar, pt, etc.)`, msg);
                }
            } else if (cmd === 'info') {
                await reply('Vortex-MD is a WhatsApp bot created by Samy Charles.', msg);
            } else if (cmd === 'autoreact') {
                const state = args[0]?.toLowerCase();
                if (state === 'on' || state === 'off') {
                    config.autoreact = state === 'on';
                    saveConfig(sessionId, config);
                    await reply(`✅ AutoReact is now ${state.toUpperCase()}`, msg);
                } else {
                    await reply(`❌ Usage: ${config.prefix}autoreact on/off`, msg);
                }
            } else if (cmd === 'aisupport') {
                const state = args[0]?.toLowerCase();
                if (state === 'on' || state === 'off') {
                    config.aisupport = state === 'on';
                    saveConfig(sessionId, config);
                    await reply(`✅ AI Support is now ${state.toUpperCase()}`, msg);
                } else {
                    await reply(`❌ Usage: ${config.prefix}aisupport on/off`, msg);
                }
            } else if (cmd === 'autostatus') {
                if (args[0] === 'on' || args[0] === 'off') {
                    config.autostatus = args[0] === 'on';
                    saveConfig(sessionId, config);
                    await reply(`✅ AutoStatus is now ${args[0].toUpperCase()}`, msg);
                } else if (args[0] === 'emoji' && args[1]) {
                    config.autostatusEmoji = args[1];
                    saveConfig(sessionId, config);
                    await reply(`✅ AutoStatus emoji set to ${args[1]}`, msg);
                } else {
                    await reply(`❌ Usage:\n${config.prefix}autostatus on/off\n${config.prefix}autostatus emoji <emoji>`, msg);
                }
            } else if (cmd === 'lock' || cmd === 'close') {
                if (!isGroup) return await reply('❌ This command can only be used in groups.');
                try {
                    const groupMetadata = await sock.groupMetadata(msg.key.remoteJid);
                    const isAdmin = groupMetadata.participants.find((p: any) => p.id === msg.key.participant)?.admin;
                    if (!isAdmin && !isFromMe) return await reply('❌ Only group admins can use this command.');
                    await sock.groupSettingUpdate(msg.key.remoteJid, 'announcement');
                    await reply('✅ Group locked. Only admins can send messages.');
                } catch (e) {
                    await reply('❌ Failed to lock group. Make sure I am an admin.');
                }
            } else if (cmd === 'unlock' || cmd === 'open') {
                if (!isGroup) return await reply('❌ This command can only be used in groups.');
                try {
                    const groupMetadata = await sock.groupMetadata(msg.key.remoteJid);
                    const isAdmin = groupMetadata.participants.find((p: any) => p.id === msg.key.participant)?.admin;
                    if (!isAdmin && !isFromMe) return await reply('❌ Only group admins can use this command.');
                    await sock.groupSettingUpdate(msg.key.remoteJid, 'not_announcement');
                    await reply('✅ Group unlocked. All participants can send messages.');
                } catch (e) {
                    await reply('❌ Failed to unlock group. Make sure I am an admin.');
                }
            } else if (cmd === 'del' || cmd === 'delete') {
                const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
                if (!contextInfo?.stanzaId) {
                    return await reply('❌ Reply to a message to delete it.');
                }
                const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const participant = contextInfo.participant || msg.key.remoteJid;
                const fromMe = participant === botJid;
                const key = {
                    remoteJid: msg.key.remoteJid,
                    fromMe: fromMe,
                    id: contextInfo.stanzaId,
                    participant: isGroup ? participant : undefined
                };
                try {
                    await sock.sendMessage(msg.key.remoteJid, { delete: key });
                } catch (e) {
                    await reply('❌ Failed to delete message. Make sure I am an admin.');
                }
            } else if (cmd === 'kickall') {
                if (!isGroup) return await reply('❌ This command can only be used in groups.');
                try {
                    const groupMetadata = await sock.groupMetadata(msg.key.remoteJid);
                    const senderId = jidNormalizedUser(sender);
                    const isAdmin = groupMetadata.participants.find((p: any) => jidNormalizedUser(p.id) === senderId)?.admin;
                    if (!isAdmin && !isFromMe) return await reply('❌ Only group admins can use this command.');
                    
                    const botId = jidNormalizedUser(sock.user.id);
                    const participants = groupMetadata.participants.filter((p: any) => !p.admin && jidNormalizedUser(p.id) !== botId);
                    if (participants.length === 0) return await reply('❌ No members to kick.');
                    
                    await reply(`⏳ Kicking ${participants.length} members...`);
                    for (let i = 0; i < participants.length; i += 5) {
                        const batch = participants.slice(i, i + 5).map((p: any) => p.id);
                        await sock.groupParticipantsUpdate(msg.key.remoteJid, batch, 'remove');
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                    await reply('✅ All non-admin members have been kicked.');
                } catch (e) {
                    await reply('❌ Failed to kick members. Make sure I am an admin.');
                }
            } else if (['welcome', 'goodbye', 'antilink', 'antispam', 'antibot', 'antifake', 'antidelete', 'antiviewonce', 'autokick', 'onlyadmin', 'antimention', 'antitoxic', 'antiforward', 'antipicture', 'antivideo', 'antiaudio', 'antidocument', 'anticontact', 'antilocation', 'antipoll', 'nsfw'].includes(cmd || '')) {
                if (!isGroup) return await reply('This command can only be used in groups.');
                
                try {
                    const groupMetadata = await sock.groupMetadata(msg.key.remoteJid);
                    const senderId = jidNormalizedUser(sender);
                    const isAdmin = groupMetadata.participants.find((p: any) => jidNormalizedUser(p.id) === senderId)?.admin;
                    
                    if (!isAdmin && !isFromMe) {
                        return await reply('❌ Only group admins can use this command.');
                    }

                    const action = args[0]?.toLowerCase();
                    
                    if (cmd === 'welcome' || cmd === 'goodbye') {
                        const configKey = cmd === 'welcome' ? 'enabledWelcome' : 'enabledGoodbye';
                        if (!config[configKey]) config[configKey] = [];
                        
                        const index = config[configKey].indexOf(msg.key.remoteJid);
                        
                        if (action === 'on') {
                            if (index === -1) config[configKey].push(msg.key.remoteJid);
                            saveConfig(sessionId, config);
                            await reply(`✅ *${cmd.toUpperCase()}* est maintenant ACTIVÉ pour ce groupe.`);
                        } else if (action === 'off') {
                            if (index !== -1) config[configKey].splice(index, 1);
                            saveConfig(sessionId, config);
                            await reply(`❌ *${cmd.toUpperCase()}* est maintenant DÉSACTIVÉ pour ce groupe.`);
                        } else {
                            await reply(`❌ Utilisation: ${config.prefix}${cmd} on/off`, msg);
                        }
                    } else {
                        if (!config[cmd]) config[cmd] = [];
                        const index = config[cmd].indexOf(msg.key.remoteJid);
                        
                        let shouldEnable = index === -1;
                        if (action === 'on' || action === 'enable') shouldEnable = true;
                        if (action === 'off' || action === 'disable') shouldEnable = false;
                        
                        if (shouldEnable) {
                            if (index === -1) {
                                config[cmd].push(msg.key.remoteJid);
                                saveConfig(sessionId, config);
                            }
                            await reply(`✅ *${cmd.toUpperCase()}* is now ENABLED for this group.`);
                        } else {
                            if (index !== -1) {
                                config[cmd].splice(index, 1);
                                saveConfig(sessionId, config);
                            }
                            await reply(`❌ *${cmd.toUpperCase()}* is now DISABLED for this group.`);
                        }
                    }
                } catch (err) {
                    await reply(`❌ Failed to toggle ${cmd}. Make sure the bot is an admin.`);
                }
            } else if (cmd === 'kick') {
                if (!isGroup) return await reply('❌ Cette commande ne peut être utilisée que dans les groupes.', msg);
                
                try {
                    const groupMetadata = await sock.groupMetadata(msg.key.remoteJid);
                    const senderId = jidNormalizedUser(sender);
                    const isAdmin = groupMetadata.participants.find((p: any) => jidNormalizedUser(p.id) === senderId)?.admin;
                    const botId = jidNormalizedUser(sock.user.id);
                    const botParticipant = groupMetadata.participants.find((p: any) => jidNormalizedUser(p.id) === botId);
                    const botIsAdmin = !!botParticipant?.admin || !!botParticipant?.isSuperAdmin;

                    if (!isAdmin && !isFromMe) return await reply('❌ Seuls les administrateurs peuvent utiliser cette commande.', msg);
                    if (!botIsAdmin) return await reply('❌ Je dois être administrateur pour expulser quelqu\'un.', msg);
                    
                    if (mentionedJid.length === 0) return await reply('❌ Veuillez mentionner ou répondre à un utilisateur pour l\'expulser.', msg);
                    
                    // Filter out: admins and the bot itself
                    const toKick = mentionedJid.filter(jid => {
                        const normalizedJid = jidNormalizedUser(jid);
                        const p = groupMetadata.participants.find(part => jidNormalizedUser(part.id) === normalizedJid);
                        const isTargetAdmin = p?.admin || p?.isSuperAdmin;
                        const isBot = normalizedJid === botId;
                        return !isTargetAdmin && !isBot;
                    });
                    
                    if (toKick.length === 0) return await reply('❌ Impossible d\'expulser des administrateurs ou le bot.', msg);

                    await sock.groupParticipantsUpdate(msg.key.remoteJid, toKick, 'remove');
                    await reply('✅ Utilisateur(s) expulsé(s) avec succès.', msg);
                } catch (e) {
                    await reply('❌ Échec de l\'expulsion. Vérifiez mes permissions.', msg);
                }
            } else if (cmd === 'promote') {
                if (!isGroup) return await reply('This command can only be used in groups.');
                if (mentionedJid.length === 0) return await reply('Please mention or reply to a user to promote.');
                try {
                    await sock.groupParticipantsUpdate(msg.key.remoteJid, mentionedJid, 'promote');
                    await reply('✅ User(s) promoted to admin.');
                } catch (e) {
                    await reply('❌ Failed to promote user. Make sure the bot is an admin.');
                }
            } else if (cmd === 'demote') {
                if (!isGroup) return await reply('This command can only be used in groups.');
                if (mentionedJid.length === 0) return await reply('Please mention or reply to a user to demote.');
                try {
                    await sock.groupParticipantsUpdate(msg.key.remoteJid, mentionedJid, 'demote');
                    await reply('✅ User(s) demoted to regular member.');
                } catch (e) {
                    await reply('❌ Failed to demote user. Make sure the bot is an admin.');
                }
            } else if (cmd === 'mute') {
                if (!isGroup) return await reply('This command can only be used in groups.');
                try {
                    await sock.groupSettingUpdate(msg.key.remoteJid, 'announcement');
                    await reply('🔇 Group has been muted. Only admins can send messages.');
                } catch (e) {
                    await reply('❌ Failed to mute group. Make sure the bot is an admin.');
                }
            } else if (cmd === 'unmute') {
                if (!isGroup) return await reply('This command can only be used in groups.');
                try {
                    await sock.groupSettingUpdate(msg.key.remoteJid, 'not_announcement');
                    await reply('🔊 Group has been unmuted. All participants can send messages.');
                } catch (e) {
                    await reply('❌ Failed to unmute group. Make sure the bot is an admin.');
                }
            } else if (cmd === 'link') {
                if (!isGroup) return await reply('This command can only be used in groups.');
                try {
                    const code = await sock.groupInviteCode(msg.key.remoteJid);
                    await reply(`🔗 Group Link:\nhttps://chat.whatsapp.com/${code}`);
                } catch (e) {
                    await reply('❌ Failed to get link. Make sure the bot is an admin.');
                }
            } else if (cmd === 'revoke') {
                if (!isGroup) return await reply('This command can only be used in groups.');
                try {
                    await sock.groupRevokeInvite(msg.key.remoteJid);
                    await reply('🔄 Group link has been successfully revoked and reset.');
                } catch (e) {
                    await reply('❌ Failed to revoke link. Make sure the bot is an admin.');
                }
            } else if (cmd === 'balance' || cmd === 'bal') {
                const user = sender;
                if (!economy[user]) economy[user] = { balance: 100, lastDaily: 0 };
                await reply(`💰 *Balance:* ${economy[user].balance} VortexCoins`, msg);
            } else if (cmd === 'daily') {
                const user = sender;
                if (!economy[user]) economy[user] = { balance: 100, lastDaily: 0 };
                const now = Date.now();
                const diff = now - economy[user].lastDaily;
                if (diff < 24 * 60 * 60 * 1000) {
                    const remaining = 24 * 60 * 60 * 1000 - diff;
                    const hours = Math.floor(remaining / (60 * 60 * 1000));
                    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
                    return await reply(`⏳ Revenez dans ${hours}h ${minutes}m pour votre récompense quotidienne !`, msg);
                }
                economy[user].balance += 500;
                economy[user].lastDaily = now;
                saveEconomy();
                await reply(`🎁 Vous avez reçu *500 VortexCoins* ! Nouveau solde: ${economy[user].balance}`, msg);
            } else if (cmd === 'afk') {
                const reason = args.join(' ') || 'Pas de raison';
                afkUsers[sender] = { reason, time: Date.now() };
                saveAfk();
                await reply(`💤 @${sender.split('@')[0]} est maintenant AFK.\n*Raison:* ${reason}`, null, { mentions: [sender] });
            } else if (cmd === 'tictactoe' || cmd === 'ttt') {
                if (!isGroup) return await reply('Cette commande est réservée aux groupes.');
                if (tttGames[msg.key.remoteJid]) return await reply('Une partie est déjà en cours dans ce groupe.');
                tttGames[msg.key.remoteJid] = {
                    board: [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
                    turn: sender,
                    player1: sender,
                    player2: null,
                    status: 'waiting'
                };
                await reply(`🎮 *TicTacToe:* @${sender.split('@')[0]} a commencé une partie !\nTapez *.jointtt* pour rejoindre.`, null, { mentions: [sender] });
            } else if (cmd === 'jointtt') {
                const game = tttGames[msg.key.remoteJid];
                if (!game) return await reply('Aucune partie en cours.');
                if (game.status !== 'waiting') return await reply('La partie a déjà commencé.');
                if (game.player1 === sender) return await reply('Vous avez déjà commencé cette partie.');
                game.player2 = sender;
                game.status = 'playing';
                await reply(`✅ @${sender.split('@')[0]} a rejoint la partie !\nC'est au tour de @${game.player1.split('@')[0]} (X).\n\nTapez *.tttpos <1-9>* pour jouer.`, null, { mentions: [sender, game.player1] });
            } else if (cmd === 'tttpos') {
                const game = tttGames[msg.key.remoteJid];
                if (!game || game.status !== 'playing') return await reply('Aucune partie en cours.');
                if (game.turn !== sender) return await reply("Ce n'est pas votre tour !");
                const pos = parseInt(args[0]) - 1;
                if (isNaN(pos) || pos < 0 || pos > 8 || game.board[pos] !== ' ') return await reply('Position invalide.');
                
                game.board[pos] = game.turn === game.player1 ? 'X' : 'O';
                game.turn = game.turn === game.player1 ? game.player2 : game.player1;

                const checkWin = (b: string[]) => {
                    const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
                    for (let w of wins) if (b[w[0]] !== ' ' && b[w[0]] === b[w[1]] && b[w[1]] === b[w[2]]) return b[w[0]];
                    if (!b.includes(' ')) return 'draw';
                    return null;
                };

                const winner = checkWin(game.board);
                let boardStr = `🎮 *TicTacToe*\n\n`;
                boardStr += ` ${game.board[0]} | ${game.board[1]} | ${game.board[2]} \n`;
                boardStr += `----------- \n`;
                boardStr += ` ${game.board[3]} | ${game.board[4]} | ${game.board[5]} \n`;
                boardStr += `----------- \n`;
                boardStr += ` ${game.board[6]} | ${game.board[7]} | ${game.board[8]} \n\n`;

                if (winner) {
                    if (winner === 'draw') boardStr += `🤝 Match nul !`;
                    else boardStr += `🎉 @${(winner === 'X' ? game.player1 : game.player2).split('@')[0]} a gagné !`;
                    delete tttGames[msg.key.remoteJid];
                    await reply(boardStr, null, { mentions: [game.player1, game.player2] });
                } else {
                    boardStr += `👉 Tour de @${game.turn.split('@')[0]}`;
                    await reply(boardStr, null, { mentions: [game.turn] });
                }
            } else if (cmd === 'delttt') {
                if (tttGames[msg.key.remoteJid]) {
                    delete tttGames[msg.key.remoteJid];
                    await reply('✅ Partie de TicTacToe supprimée.');
                }
            } else if (cmd === 'bank') {
                const user = sender;
                if (!economy[user]) economy[user] = { balance: 100, lastDaily: 0, bank: 0 };
                if (economy[user].bank === undefined) economy[user].bank = 0;
                await reply(`🏦 *Banque:* ${economy[user].bank} VortexCoins\n💰 *Poche:* ${economy[user].balance} VortexCoins`, msg);
            } else if (cmd === 'deposit' || cmd === 'dep') {
                const user = sender;
                if (!economy[user]) economy[user] = { balance: 100, lastDaily: 0, bank: 0 };
                if (economy[user].bank === undefined) economy[user].bank = 0;
                const amount = args[0] === 'all' ? economy[user].balance : parseInt(args[0]);
                if (isNaN(amount) || amount <= 0) return await reply('❌ Montant invalide.', msg);
                if (amount > economy[user].balance) return await reply('❌ Vous n\'avez pas assez d\'argent en poche.', msg);
                economy[user].balance -= amount;
                economy[user].bank += amount;
                saveEconomy();
                await reply(`✅ Vous avez déposé ${amount} VortexCoins à la banque.`, msg);
            } else if (cmd === 'withdraw' || cmd === 'wd') {
                const user = sender;
                if (!economy[user]) economy[user] = { balance: 100, lastDaily: 0, bank: 0 };
                if (economy[user].bank === undefined) economy[user].bank = 0;
                const amount = args[0] === 'all' ? economy[user].bank : parseInt(args[0]);
                if (isNaN(amount) || amount <= 0) return await reply('❌ Montant invalide.', msg);
                if (amount > economy[user].bank) return await reply('❌ Vous n\'avez pas assez d\'argent en banque.', msg);
                economy[user].bank -= amount;
                economy[user].balance += amount;
                saveEconomy();
                await reply(`✅ Vous avez retiré ${amount} VortexCoins de la banque.`, msg);
            } else if (cmd === 'transfer') {
                const user = sender;
                if (!economy[user]) economy[user] = { balance: 100, lastDaily: 0, bank: 0 };
                if (mentionedJid.length === 0) return await reply('❌ Mentionnez l\'utilisateur à qui vous voulez transférer de l\'argent.', msg);
                const target = mentionedJid[0];
                const amount = parseInt(args[0]);
                if (isNaN(amount) || amount <= 0) return await reply('❌ Montant invalide.', msg);
                if (amount > economy[user].balance) return await reply('❌ Vous n\'avez pas assez d\'argent en poche.', msg);
                if (!economy[target]) economy[target] = { balance: 100, lastDaily: 0, bank: 0 };
                economy[user].balance -= amount;
                economy[target].balance += amount;
                saveEconomy();
                await reply(`✅ Vous avez transféré ${amount} VortexCoins à @${target.split('@')[0]}.`, msg, { mentions: [target] });
            } else if (cmd === 'rps') {
                if (args.length === 0) return await reply(`❌ Usage: ${config.prefix}rps <pierre|papier|ciseaux>`, msg);
                const choices = ['pierre', 'papier', 'ciseaux'];
                const userChoice = args[0].toLowerCase();
                if (!choices.includes(userChoice)) return await reply('❌ Choix invalide. Choisissez entre pierre, papier ou ciseaux.', msg);
                const botChoice = choices[Math.floor(Math.random() * choices.length)];
                let result = '';
                if (userChoice === botChoice) result = '🤝 Match nul !';
                else if ((userChoice === 'pierre' && botChoice === 'ciseaux') || (userChoice === 'papier' && botChoice === 'pierre') || (userChoice === 'ciseaux' && botChoice === 'papier')) result = '🎉 Vous avez gagné !';
                else result = '😢 Vous avez perdu !';
                await reply(`🎮 *RPS*\n\n👤 Vous: ${userChoice}\n🤖 Bot: ${botChoice}\n\n${result}`, msg);
            } else if (cmd === 'poll') {
                if (args.length < 2) return await reply(`❌ Usage: ${config.prefix}poll Question | Option1 | Option2 | ...`, msg);
                const [question, ...options] = args.join(' ').split('|').map(s => s.trim());
                if (options.length < 2) return await reply('❌ Il faut au moins 2 options.', msg);
                await sock.sendMessage(msg.key.remoteJid, {
                    poll: {
                        name: question,
                        values: options,
                        selectableCount: 1
                    }
                }, { quoted: msg });
            } else if (cmd === 'unafk') {
                if (afkUsers[sender]) {
                    delete afkUsers[sender];
                    saveAfk();
                    await reply('✅ Vous n\'êtes plus AFK.', msg);
                } else {
                    await reply('❌ Vous n\'étiez pas AFK.', msg);
                }
            } else if (cmd === 'tagall') {
                if (!isAdmin && !isFromMe) return await reply('❌ Cette commande est réservée aux administrateurs.', msg);
                const groupMetadata = await sock.groupMetadata(msg.key.remoteJid);
                const participants = groupMetadata.participants;
                const groupName = groupMetadata.subject;
                let groupPfp;
                try {
                    groupPfp = await sock.profilePictureUrl(msg.key.remoteJid, 'image');
                } catch (e) {
                    groupPfp = 'https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png';
                }

                let response = `╭── ◈ *ᴛᴀɢ ᴀʟʟ* ◈ ──╮\n`;
                response += `│ 📢 *Message:* ${args.join(' ') || 'Pas de message'}\n`;
                response += `│ 👥 *Total:* ${participants.length}\n`;
                response += `│ 🏛️ *Groupe:* ${groupName}\n`;
                response += `╰────────────────╯\n\n`;
                
                for (let mem of participants) {
                    response += `│ ✨ @${mem.id.split('@')[0]}\n`;
                }
                
                response += `╰────────────────╯\n\n*VORTEX-MD BY SAMY*`;
                
                await sock.sendMessage(msg.key.remoteJid, { 
                    image: { url: groupPfp },
                    caption: response, 
                    mentions: participants.map(a => a.id),
                    contextInfo: {
                        forwardingScore: 999,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: '120363283626456789@newsletter',
                            serverMessageId: 1,
                            newsletterName: 'VORTEX-MD CHANNEL'
                        }
                    }
                }, { quoted: msg });
            } else if (cmd === 'play') {
                const query = args.join(' ');
                if (!query) return await reply("Merci d'écrire le nom de la musique après .play");
                
                await reply(`🔍 Recherche de *${query}* sur YouTube...`);
                
                try {
                    const search = await yts(query);
                    const video = search.videos[0];
                    if (!video) return await reply(`❌ Aucune musique trouvée pour : ${query}`);
                    
                    const info = `🎵 *Titre:* ${video.title}\n👤 *Artiste:* ${video.author.name}\n🕒 *Durée:* ${video.timestamp}\n🔗 *Lien:* ${video.url}\n\n*VORTEX-MD BY SAMY*`;
                    
                    await sock.sendMessage(msg.key.remoteJid, { 
                        image: { url: video.thumbnail }, 
                        caption: info 
                    }, { quoted: msg });
                    
                    const tempDir = './temp';
                    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
                    
                    const filePath = path.join(tempDir, `${Date.now()}.mp3`);
                    
                    await reply("⏳ *Traitement en cours...* Votre audio sera envoyé dans quelques instants. 🎧");

                    const downloadAudio = async (url: string, dest: string) => {
                        try {
                            // Try ytdl first with custom headers
                            const stream = ytdl(url, { 
                                filter: 'audioonly', 
                                quality: 'highestaudio',
                                requestOptions: {
                                    headers: {
                                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                                    }
                                }
                            });
                            const writeStream = fs.createWriteStream(dest);
                            stream.pipe(writeStream);
                            return new Promise((resolve, reject) => {
                                writeStream.on('finish', () => resolve(true));
                                writeStream.on('error', reject);
                                stream.on('error', reject);
                            });
                        } catch (e: any) {
                            console.log('ytdl failed, trying API fallback...', e.message);
                            // Fallback to external API if ytdl is blocked
                            const apis = [
                                `https://api.popcat.xyz/ytmp3?url=${encodeURIComponent(url)}`,
                                `https://api.dhamprojects.com/ytmp3?url=${encodeURIComponent(url)}`
                            ];
                            
                            for (const api of apis) {
                                try {
                                    const res = await axios.get(api);
                                    const downloadUrl = res.data?.url || res.data?.result?.url || res.data?.link;
                                    if (downloadUrl) {
                                        const response = await axios.get(downloadUrl, { responseType: 'stream' });
                                        const writeStream = fs.createWriteStream(dest);
                                        response.data.pipe(writeStream);
                                        return new Promise((resolve, reject) => {
                                            writeStream.on('finish', () => resolve(true));
                                            writeStream.on('error', reject);
                                        });
                                    }
                                } catch (apiErr) {
                                    console.error(`API fallback ${api} failed:`, apiErr);
                                }
                            }
                            
                            // Last resort: try a generic downloader API
                            try {
                                const res = await axios.get(`https://api.delfaapiai.vercel.app/downloader/ytmp3?url=${encodeURIComponent(url)}`);
                                const downloadUrl = res.data?.data?.url || res.data?.url;
                                if (downloadUrl) {
                                    const response = await axios.get(downloadUrl, { responseType: 'stream' });
                                    const writeStream = fs.createWriteStream(dest);
                                    response.data.pipe(writeStream);
                                    return new Promise((resolve, reject) => {
                                        writeStream.on('finish', () => resolve(true));
                                        writeStream.on('error', reject);
                                    });
                                }
                            } catch (e2) {
                                console.error('Final fallback failed:', e2);
                            }
                            
                            throw e; // If all fallbacks fail, throw original error
                        }
                    };

                    downloadAudio(video.url, filePath).then(async () => {
                        try {
                            const fileName = path.basename(filePath);
                            const publicPath = path.join(uploadsDir, fileName);
                            
                            // Move file to public uploads for local hosting
                            if (fs.existsSync(filePath)) {
                                fs.renameSync(filePath, publicPath);
                            } else {
                                throw new Error('File not found after download');
                            }
                            
                            const appUrl = process.env.APP_URL || '';
                            const localHostedUrl = appUrl ? `${appUrl.replace(/\/$/, '')}/uploads/${fileName}` : null;

                            // Try Supabase first if key exists, otherwise use local
                            let hostedUrl = null;
                            if (process.env.SUPABASE_API_KEY && process.env.SUPABASE_API_KEY !== 'YOUR_SUPABASE_API_KEY') {
                                try {
                                    const formData = new FormData();
                                    formData.append('file', fs.createReadStream(publicPath));
                                    const uploadRes = await axios.post('https://lieixmgdboiceopzksvu.supabase.co/functions/v1/upload', formData, {
                                        headers: {
                                            ...formData.getHeaders(),
                                            'x-api-key': process.env.SUPABASE_API_KEY
                                        }
                                    });
                                    hostedUrl = uploadRes.data?.url || uploadRes.data?.publicUrl;
                                } catch (e) {
                                    console.error('Supabase upload failed:', e);
                                }
                            }

                            // Use local URL if Supabase failed or wasn't configured
                            const finalUrl = hostedUrl || localHostedUrl;
                            
                            if (finalUrl) {
                                await sock.sendMessage(msg.key.remoteJid, {
                                    audio: { url: finalUrl },
                                    mimetype: 'audio/mpeg',
                                    fileName: `${video.title}.mp3`,
                                    contextInfo: {
                                        externalAdReply: {
                                            title: video.title,
                                            body: video.author.name,
                                            thumbnailUrl: video.thumbnail,
                                            mediaType: 2,
                                            mediaUrl: video.url,
                                            sourceUrl: finalUrl
                                        }
                                    }
                                }, { quoted: msg });
                            } else {
                                await sock.sendMessage(msg.key.remoteJid, {
                                    audio: fs.readFileSync(publicPath),
                                    mimetype: 'audio/mpeg',
                                    fileName: `${video.title}.mp3`
                                }, { quoted: msg });
                            }

                            // Cleanup local file after 10 minutes to save space
                            setTimeout(() => {
                                if (fs.existsSync(publicPath)) fs.unlinkSync(publicPath);
                            }, 10 * 60 * 1000);

                        } catch (uploadError) {
                            console.error('Processing failed, sending directly:', uploadError);
                            if (fs.existsSync(filePath)) {
                                await sock.sendMessage(msg.key.remoteJid, {
                                    audio: fs.readFileSync(filePath),
                                    mimetype: 'audio/mpeg',
                                    fileName: `${video.title}.mp3`
                                }, { quoted: msg });
                                fs.unlinkSync(filePath);
                            }
                        }
                    }).catch(async (err) => {
                        console.error('Download failed:', err);
                        await reply("❌ Impossible de télécharger l'audio. YouTube bloque peut-être la connexion. Réessayez plus tard.");
                        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                    });
                } catch (e) {
                    console.error(e);
                    await reply("❌ Une erreur est survenue lors de la commande .play");
                }
            } else if (cmd === 'pair') {
                if (args.length === 0) return await reply(`❌ Utilisation: ${config.prefix}pair <numéro>\nExemple: ${config.prefix}pair 33612345678`, msg);
                const phoneNumber = args[0].replace(/\D/g, '');
                await reply(`⏳ Demande de code de jumelage pour +${phoneNumber}...`, msg);
                try {
                    const sessionId = phoneNumber;
                    const code = await startBot(sessionId, phoneNumber);
                    if (code) {
                        await reply(`✅ Code de jumelage pour +${phoneNumber}: *${code}*\n\nEntrez ce code dans vos appareils connectés WhatsApp.`, msg);
                    } else {
                        await reply(`❌ Ce numéro est déjà connecté ou en cours de connexion.`, msg);
                    }
                } catch (e: any) {
                    await reply(`❌ Erreur: ${e.message}`, msg);
                }
            } else if (cmd === 'hidetag') {
                if (!isGroup) return await reply('This command can only be used in groups.');
                try {
                    const groupMetadata = await sock.groupMetadata(msg.key.remoteJid);
                    const participants = groupMetadata.participants.map((a: any) => a.id);
                    const responseText = args.join(' ') || 'Attention!';
                    await reply(responseText, null, { mentions: participants });
                } catch (e) {
                    await reply('❌ Failed to hidetag.');
                }
            } else if (cmd === 'vv') {
                try {
                    const contextInfo = msg.message?.extendedTextMessage?.contextInfo || msg.message?.imageMessage?.contextInfo || msg.message?.videoMessage?.contextInfo;
                    const quotedMsg = contextInfo?.quotedMessage;
                    if (!quotedMsg) {
                        await reply('❌ Please reply to a View Once message with !vv');
                        return;
                    }

                    let mediaMsg = quotedMsg.viewOnceMessage?.message || quotedMsg.viewOnceMessageV2?.message || quotedMsg.viewOnceMessageV2Extension?.message;
                    if (!mediaMsg) {
                        if (quotedMsg.imageMessage?.viewOnce || quotedMsg.videoMessage?.viewOnce || quotedMsg.audioMessage?.viewOnce) {
                            mediaMsg = quotedMsg;
                        }
                    }

                    if (!mediaMsg) {
                        await reply('❌ The replied message is not a View Once message.');
                        return;
                    }

                    const mediaType = Object.keys(mediaMsg).find(k => ['imageMessage', 'videoMessage', 'audioMessage'].includes(k));
                    if (!mediaType) {
                        await reply('❌ No supported media found in the View Once message.');
                        return;
                    }

                    const media = mediaMsg[mediaType];
                    const stream = await downloadContentFromMessage(media, mediaType.replace('Message', '') as any);
                    let buffer = Buffer.from([]);
                    for await(const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

                    const caption = media.caption ? `\n\n📝 Caption: ${media.caption}` : '';
                    const text = `👁️ *VIEW ONCE REVEALED* 👁️${caption}`;

                    if (mediaType === 'imageMessage') {
                        await sock.sendMessage(msg.key.remoteJid, { image: buffer, caption: text });
                    } else if (mediaType === 'videoMessage') {
                        await sock.sendMessage(msg.key.remoteJid, { video: buffer, caption: text });
                    } else if (mediaType === 'audioMessage') {
                        await sock.sendMessage(msg.key.remoteJid, { audio: buffer, mimetype: 'audio/mp4', ptt: true });
                    }
                } catch (e) {
                    console.error('Error in vv:', e);
                    await reply('❌ Failed to download the View Once media. It might have expired or the bot lacks access.');
                }
            } else if (cmd === 'status' || cmd === 'getstatus' || cmd === 'save') {
                try {
                    const contextInfo = msg.message?.extendedTextMessage?.contextInfo || msg.message?.imageMessage?.contextInfo || msg.message?.videoMessage?.contextInfo;
                    const quotedMsg = contextInfo?.quotedMessage;
                    if (!quotedMsg) {
                        await reply('❌ Please reply to a status/story to download it.');
                        return;
                    }

                    const mediaType = Object.keys(quotedMsg).find(k => ['imageMessage', 'videoMessage', 'audioMessage', 'extendedTextMessage', 'conversation'].includes(k));
                    
                    if (mediaType === 'extendedTextMessage' || mediaType === 'conversation') {
                        const text = quotedMsg.extendedTextMessage?.text || quotedMsg.conversation;
                        await reply(`📝 *Status Text:*\n\n${text}`);
                        return;
                    }

                    if (!mediaType || !['imageMessage', 'videoMessage', 'audioMessage'].includes(mediaType)) {
                        await reply('❌ The replied status does not contain supported media.');
                        return;
                    }

                    const media = quotedMsg[mediaType];
                    const stream = await downloadContentFromMessage(media, mediaType.replace('Message', '') as any);
                    let buffer = Buffer.from([]);
                    for await(const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

                    const caption = media.caption || '';
                    
                    if (mediaType === 'imageMessage') {
                        await sock.sendMessage(msg.key.remoteJid, { image: buffer, caption: caption });
                    } else if (mediaType === 'videoMessage') {
                        await sock.sendMessage(msg.key.remoteJid, { video: buffer, caption: caption });
                    } else if (mediaType === 'audioMessage') {
                        await sock.sendMessage(msg.key.remoteJid, { audio: buffer, mimetype: 'audio/mp4' });
                    }
                } catch (e) {
                    console.error('Error in status:', e);
                    await reply('❌ Failed to download the status media. It might have expired.');
                }
            } else if (cmd === 'getchannelid') {
                if (args.length > 0) {
                    const link = args[0];
                    if (link.includes('whatsapp.com/channel/')) {
                        const code = link.split('/').pop();
                        try {
                            const metadata = await sock.newsletterMetadata("invite", code);
                            await reply(`📢 *Channel Info*\n\n*Name:* ${metadata.name}\n*JID:* ${metadata.id}\n\nReplace the 'newsletterJid' in the code with this JID.`);
                        } catch (e) {
                            await reply(`❌ Failed to get channel info from link. Make sure the link is correct.`);
                        }
                    } else {
                        await reply(`❌ Please provide a valid WhatsApp channel link.`);
                    }
                } else {
                    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
                    if (contextInfo?.forwardedNewsletterMessageInfo) {
                        const jid = contextInfo.forwardedNewsletterMessageInfo.newsletterJid;
                        const name = contextInfo.forwardedNewsletterMessageInfo.newsletterName;
                        await reply(`📢 *Channel Info*\n\n*Name:* ${name}\n*JID:* ${jid}\n\nReplace the 'newsletterJid' in the code with this JID.`);
                    } else {
                        await reply(`❌ Please reply to a message forwarded from a channel or provide a channel link.`);
                    }
                }
            } else if (cmd === 'owner' || cmd === 'creator') {
                await reply(`👑 *Owner Info*\n\nName: Samy Charles\nRole: Creator of Vortex-MD\nStatus: Active`, msg);
            } else if (cmd === 'rules') {
                await reply(`📋 *Vortex-MD Rules*\n\n1. Do not spam commands.\n2. Do not use the bot for illegal activities.\n3. Respect other users.\n4. Have fun!`, msg);
            } else if (cmd === 'sticker' || cmd === 's') {
                const isQuotedImage = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                const isQuotedVideo = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage;
                const isImage = msg.message.imageMessage;
                const isVideo = msg.message.videoMessage;

                const argsParts = args.join(' ').split('|');
                const packName = argsParts[0] || '𝗩𝗼𝗿𝘁𝗲𝘅-𝗠𝗗 🧑‍🔬🗽';
                const authorName = argsParts[1] || 'Samy Charles';

                if (isImage || isQuotedImage || isVideo || isQuotedVideo) {
                    await sock.sendMessage(msg.key.remoteJid, { react: { text: '⏳', key: msg.key } });
                    try {
                        let buffer;
                        if (isImage) {
                            buffer = await getMediaBuffer(isImage, 'image');
                        } else if (isQuotedImage) {
                            buffer = await getMediaBuffer(isQuotedImage, 'image');
                        } else if (isVideo) {
                            buffer = await getMediaBuffer(isVideo, 'video');
                        } else if (isQuotedVideo) {
                            buffer = await getMediaBuffer(isQuotedVideo, 'video');
                        }
                        
                        const tempFile = path.join(process.cwd(), `temp_${Date.now()}.${isVideo || isQuotedVideo ? 'mp4' : 'jpg'}`);
                        fs.writeFileSync(tempFile, buffer);

                        const sticker = new Sticker(tempFile, {
                            pack: packName, // The pack name
                            author: authorName, // The author name
                            type: StickerTypes.FULL, // The sticker type
                            categories: ['🎉', '✨'], // The sticker category
                            id: '12345', // The sticker id
                            quality: 50, // The quality of the output file
                            background: '#000000' // The sticker background color (only for full stickers)
                        });

                        const stickerBuffer = await sticker.toBuffer();
                        await sock.sendMessage(msg.key.remoteJid, { sticker: stickerBuffer }, { quoted: msg });
                        
                        fs.unlinkSync(tempFile);
                    } catch (e) {
                        console.error(e);
                        await reply('❌ Failed to create sticker.', msg);
                    }
                } else {
                    await reply('❌ Please reply to an image or video with .sticker', msg);
                }
            } else if (cmd === 'getsticker' || cmd === 'gs') {
                if (args.length === 0) return await reply(`❌ Usage: ${config.prefix}getsticker <query>`, msg);
                const query = args.join(' ');
                await sock.sendMessage(msg.key.remoteJid, { react: { text: '⏳', key: msg.key } });
                try {
                    const res = await axios.get(`https://g.tenor.com/v1/search?q=${encodeURIComponent(query)}&key=LIVDSRZULELA&limit=1`);
                    if (res.data.results && res.data.results.length > 0) {
                        const gifUrl = res.data.results[0].media[0].mp4.url;
                        
                        const tempFile = path.join(process.cwd(), `temp_${Date.now()}.mp4`);
                        const response = await axios({
                            url: gifUrl,
                            method: 'GET',
                            responseType: 'arraybuffer'
                        });
                        fs.writeFileSync(tempFile, response.data);

                        const sticker = new Sticker(tempFile, {
                            pack: '𝗩𝗼𝗿𝘁𝗲𝘅-𝗠𝗗 🧑‍🔬🗽',
                            author: 'Samy Charles',
                            type: StickerTypes.FULL,
                            categories: ['🎉', '✨'],
                            quality: 50,
                            background: '#000000'
                        });

                        const stickerBuffer = await sticker.toBuffer();
                        await sock.sendMessage(msg.key.remoteJid, { sticker: stickerBuffer }, { quoted: msg });
                        
                        fs.unlinkSync(tempFile);
                    } else {
                        await reply('❌ No stickers found.', msg);
                    }
                } catch (e) {
                    console.error('getsticker error:', e);
                    await reply('❌ Failed to fetch sticker.', msg);
                }
            } else if (cmd === 'toimg') {
                const isQuotedSticker = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage;
                if (isQuotedSticker) {
                    await sock.sendMessage(msg.key.remoteJid, { react: { text: '⏳', key: msg.key } });
                    try {
                        const buffer = await getMediaBuffer(isQuotedSticker, 'sticker');
                        const tempFile = path.join(process.cwd(), `temp_${Date.now()}.webp`);
                        const outImg = path.join(process.cwd(), `img_${Date.now()}.png`);
                        
                        fs.writeFileSync(tempFile, buffer);

                        await new Promise((resolve, reject) => {
                            ffmpeg(tempFile)
                                .outputOptions(['-vf', 'scale=1024:1024:flags=lanczos']) // Upscale to HD
                                .on('error', reject)
                                .on('end', () => resolve(true))
                                .save(outImg);
                        });

                        const imgBuffer = fs.readFileSync(outImg);
                        await sock.sendMessage(msg.key.remoteJid, { 
                            document: imgBuffer, 
                            mimetype: 'image/png', 
                            fileName: 'Vortex-MD-HD.png',
                            caption: '🖼️ Image HD générée par Vortex-MD !' 
                        }, { quoted: msg });
                        
                        fs.unlinkSync(tempFile);
                        fs.unlinkSync(outImg);
                    } catch (e) {
                        console.error(e);
                        await reply('❌ Failed to convert sticker to image.', msg);
                    }
                } else {
                    await reply('❌ Please reply to a sticker with .toimg', msg);
                }
            } else if (cmd === 'joke' || cmd === 'blague') {
                try {
                    const res = await axios.get('https://v2.jokeapi.dev/joke/Any?safe-mode');
                    const joke = res.data.type === 'twopart' ? `${res.data.setup}\n\n${res.data.delivery}` : res.data.joke;
                    await reply(`😂 *Joke:*\n\n${joke}`, msg);
                } catch (e) {
                    await reply('❌ Failed to fetch joke.', msg);
                }
            } else if (cmd === 'dog' || cmd === 'chien') {
                try {
                    const res = await axios.get('https://dog.ceo/api/breeds/image/random');
                    await sock.sendMessage(msg.key.remoteJid, { image: { url: res.data.message }, caption: '🐶 Woof!' }, { quoted: msg });
                } catch (e) {
                    await reply('❌ Failed to fetch dog image.', msg);
                }
            } else if (cmd === 'cat' || cmd === 'chat') {
                try {
                    const res = await axios.get('https://api.thecatapi.com/v1/images/search');
                    await sock.sendMessage(msg.key.remoteJid, { image: { url: res.data[0].url }, caption: '🐱 Meow!' }, { quoted: msg });
                } catch (e) {
                    await reply('❌ Failed to fetch cat image.', msg);
                }
            } else if (cmd === 'fact' || cmd === 'fait') {
                try {
                    const res = await axios.get('https://uselessfacts.jsph.pl/api/v2/facts/random');
                    await reply(`🧠 *Fact:*\n\n${res.data.text}`, msg);
                } catch (e) {
                    await reply('❌ Failed to fetch fact.', msg);
                }
            } else if (cmd === 'fb' || cmd === 'facebook') {
                if (args.length === 0) return await reply(`❌ Usage: ${config.prefix}fb <url>`, msg);
                const url = args[0];
                await sock.sendMessage(msg.key.remoteJid, { react: { text: '⏳', key: msg.key } });
                try {
                    const res = await axios.get(`https://delfaapiai.vercel.app/downloader/fbdl?url=${encodeURIComponent(url)}`);
                    const videoUrl = res.data?.data?.url || res.data?.url || res.data?.result?.url || res.data?.video;
                    if (!videoUrl) throw new Error('No video URL found');
                    await sock.sendMessage(msg.key.remoteJid, { video: { url: videoUrl }, caption: '📱 *Facebook Downloader*' }, { quoted: msg });
                } catch (e) {
                    await reply(`❌ Failed to download Facebook video.`, msg);
                }
            } else if (cmd === 'tiktok' || cmd === 'tt') {
                if (args.length === 0) return await reply(`❌ Usage: ${config.prefix}tiktok <url>`, msg);
                const url = args[0];
                await sock.sendMessage(msg.key.remoteJid, { react: { text: '⏳', key: msg.key } });
                try {
                    const res = await axios.get(`https://delfaapiai.vercel.app/downloader/tikdl?url=${encodeURIComponent(url)}`);
                    const videoUrl = res.data?.data?.url || res.data?.url || res.data?.result?.url || res.data?.video;
                    if (!videoUrl) throw new Error('No video URL found');
                    await sock.sendMessage(msg.key.remoteJid, { video: { url: videoUrl }, caption: '📱 *TikTok Downloader*' }, { quoted: msg });
                } catch (e) {
                    await reply(`❌ Failed to download TikTok video.`, msg);
                }
            } else if (cmd === 'video') {
                if (args.length === 0) return await reply(`❌ Usage: ${config.prefix}video <titre>`, msg);
                const query = args.join(' ');
                await sock.sendMessage(msg.key.remoteJid, { react: { text: '⏳', key: msg.key } });
                try {
                    const search = await yts(query);
                    const video = search.videos[0];
                    if (!video) return await reply('❌ Aucun résultat trouvé.', msg);

                    await reply(`🎬 *Téléchargement de la vidéo :* ${video.title}\n_Veuillez patienter..._`, msg);

                    const tempFile = path.join(process.cwd(), `temp_video_${Date.now()}.mp4`);
                    
                    const downloadVideo = async (url: string, dest: string) => {
                        try {
                            const stream = ytdl(url, { 
                                filter: 'audioandvideo', 
                                quality: 'highest',
                                requestOptions: {
                                    headers: {
                                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                                    }
                                }
                            });
                            const fileStream = fs.createWriteStream(dest);
                            stream.pipe(fileStream);
                            return new Promise((resolve, reject) => {
                                fileStream.on('finish', () => resolve(true));
                                fileStream.on('error', reject);
                                stream.on('error', reject);
                            });
                        } catch (e: any) {
                            console.log('ytdl video failed, trying API fallback...', e.message);
                            const apis = [
                                `https://api.popcat.xyz/ytmp4?url=${encodeURIComponent(url)}`,
                                `https://api.dhamprojects.com/ytmp4?url=${encodeURIComponent(url)}`,
                                `https://api.vytmp3.com/ytmp4?url=${encodeURIComponent(url)}`
                            ];
                            for (const api of apis) {
                                try {
                                    const res = await axios.get(api);
                                    const downloadUrl = res.data?.url || res.data?.result?.url || res.data?.link;
                                    if (downloadUrl) {
                                        const response = await axios.get(downloadUrl, { responseType: 'stream' });
                                        const fileStream = fs.createWriteStream(dest);
                                        response.data.pipe(fileStream);
                                        return new Promise((resolve, reject) => {
                                            fileStream.on('finish', () => resolve(true));
                                            fileStream.on('error', reject);
                                        });
                                    }
                                } catch (apiErr) {
                                    console.error(`API fallback ${api} failed:`, apiErr);
                                }
                            }
                            
                            // Last resort: try a generic downloader API
                            try {
                                const res = await axios.get(`https://api.delfaapiai.vercel.app/downloader/ytmp4?url=${encodeURIComponent(url)}`);
                                const downloadUrl = res.data?.data?.url || res.data?.url;
                                if (downloadUrl) {
                                    const response = await axios.get(downloadUrl, { responseType: 'stream' });
                                    const fileStream = fs.createWriteStream(dest);
                                    response.data.pipe(fileStream);
                                    return new Promise((resolve, reject) => {
                                        fileStream.on('finish', () => resolve(true));
                                        fileStream.on('error', reject);
                                    });
                                }
                            } catch (e2) {
                                console.error('Final fallback failed:', e2);
                            }
                            
                            throw e;
                        }
                    };

                    downloadVideo(video.url, tempFile).then(async () => {
                        try {
                            const formData = new FormData();
                            formData.append('file', fs.createReadStream(tempFile));
                            
                            const uploadRes = await axios.post('https://lieixmgdboiceopzksvu.supabase.co/functions/v1/upload', formData, {
                                headers: {
                                    ...formData.getHeaders(),
                                    'x-api-key': process.env.SUPABASE_API_KEY || 'VOTRE_CLE_API'
                                }
                            });
                            
                            const hostedUrl = uploadRes.data?.url || uploadRes.data?.publicUrl;
                            
                            if (hostedUrl) {
                                await sock.sendMessage(msg.key.remoteJid, { 
                                    video: { url: hostedUrl },
                                    caption: `🎬 *${video.title}*\n🔗 Lien hébergé : ${hostedUrl}`
                                }, { quoted: msg });
                            } else {
                                await sock.sendMessage(msg.key.remoteJid, { 
                                    video: fs.readFileSync(tempFile),
                                    caption: `🎬 *${video.title}*`
                                }, { quoted: msg });
                            }
                        } catch (uploadError) {
                            console.error('Upload failed, sending directly:', uploadError);
                            await sock.sendMessage(msg.key.remoteJid, { 
                                video: fs.readFileSync(tempFile),
                                caption: `🎬 *${video.title}*`
                            }, { quoted: msg });
                        } finally {
                            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
                        }
                    }).catch(async (err) => {
                        console.error('Video download failed:', err);
                        await reply("❌ Impossible de télécharger la vidéo. YouTube bloque peut-être la connexion. Réessayez plus tard.");
                        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
                    });
                } catch (e) {
                    await reply(`❌ Erreur lors de la recherche ou du téléchargement de la vidéo.`, msg);
                }
            } else if (cmd === 'pair') {
                if (args.length === 0) return await reply(`❌ Usage: ${config.prefix}pair <numéro avec indicatif>`, msg);
                const phoneNumber = args[0].replace(/[^0-9]/g, '');
                if (!phoneNumber) return await reply(`❌ Numéro invalide.`, msg);
                
                await reply(`⏳ Génération du code de connexion pour ${phoneNumber}...`, msg);
                try {
                    const code = await startBot(phoneNumber, phoneNumber);
                    if (code) {
                        await reply(`✅ Voici votre code de connexion WhatsApp :\n\n*${code}*\n\nEntrez ce code dans WhatsApp > Appareils connectés > Lier un appareil > Lier avec le numéro de téléphone.`, msg);
                    } else {
                        await reply(`⚠️ Cette session est déjà connectée ou en cours de connexion.`, msg);
                    }
                } catch (error: any) {
                    await reply(`❌ Erreur : ${error.message}`, msg);
                }
            } else if (cmd === 'runtime' || cmd === 'uptime') {
                await reply(`⏳ *Uptime:* ${formatUptime(Date.now() - startTime)}`, msg);
            } else if (cmd === 'donate') {
                await reply(`☕ *Donate*\n\nSupport the development of Vortex-MD!\nContact the owner for donation links.`);
            } else if (cmd === 'qr') {
                if (args.length === 0) return await reply(`❌ Provide text to generate QR. Example: ${config.prefix}qr Hello`);
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(args.join(' '))}`;
                await sock.sendMessage(msg.key.remoteJid, { image: { url: qrUrl }, caption: '🔳 Here is your QR Code!' });
            } else if (cmd === 'shorturl') {
                if (args.length === 0) return await reply(`❌ Provide a URL. Example: ${config.prefix}shorturl https://google.com`);
                try {
                    const res = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(args[0])}`);
                    await reply(`🔗 *Short URL:*\n${res.data}`);
                } catch (e) {
                    await reply('❌ Failed to shorten URL.');
                }
            } else if (cmd === 'base64') {
                if (args.length === 0) return await reply(`❌ Provide text to encode.`);
                const encoded = Buffer.from(args.join(' ')).toString('base64');
                await reply(`🔐 *Base64 Encoded:*\n${encoded}`);
            } else if (cmd === 'password') {
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()';
                let pass = '';
                for (let i = 0; i < 12; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
                await reply(`🔑 *Generated Password:*\n${pass}`);
            } else if (cmd === 'truth') {
                const truths = ["What's your biggest fear?", "What's a secret you've never told anyone?", "Who is your crush?", "What's the most embarrassing thing you've done?"];
                await reply(`🤫 *Truth:*\n${truths[Math.floor(Math.random() * truths.length)]}`);
            } else if (cmd === 'dare') {
                const dares = ["Send a voice note singing a song.", "Change your profile picture to a monkey for 1 hour.", "Send a message to your crush.", "Do 10 pushups and send a video."];
                await reply(`😈 *Dare:*\n${dares[Math.floor(Math.random() * dares.length)]}`);
            } else if (cmd === 'flipcoin') {
                const coin = Math.random() < 0.5 ? 'Heads' : 'Tails';
                await reply(`🪙 The coin landed on: *${coin}*`);
            } else if (cmd === 'roll') {
                const dice = Math.floor(Math.random() * 6) + 1;
                await reply(`🎲 You rolled a *${dice}*!`);
            } else if (cmd === '8ball') {
                if (args.length === 0) return await reply(`❌ Ask a question!`);
                const answers = ["Yes, definitely.", "It is certain.", "Without a doubt.", "Reply hazy, try again.", "Ask again later.", "Don't count on it.", "My reply is no.", "Very doubtful."];
                await reply(`🎱 *8Ball says:*\n${answers[Math.floor(Math.random() * answers.length)]}`);
            } else if (cmd === 'rate') {
                if (args.length === 0) return await reply(`❌ Provide something to rate!`);
                const rating = Math.floor(Math.random() * 101);
                await reply(`⭐ I rate *${args.join(' ')}* a solid *${rating}/100*!`);
            } else if (cmd === 'sysinfo' || cmd === 'os' || cmd === 'cpu' || cmd === 'ram') {
                const totalMem = Math.round(os.totalmem() / 1024 / 1024);
                const freeMem = Math.round(os.freemem() / 1024 / 1024);
                const usedMem = totalMem - freeMem;
                const cpu = os.cpus()[0].model;
                const info = `💻 *SYSTEM INFO* 💻\n\n` +
                             `🖥️ *OS:* ${os.type()} ${os.release()}\n` +
                             `🧠 *CPU:* ${cpu}\n` +
                             `💾 *RAM:* ${usedMem}MB / ${totalMem}MB\n` +
                             `⚙️ *Platform:* ${os.platform()}`;
                await reply(info);
            } else if (cmd === 'hack') {
                const target = args.length > 0 ? args.join(' ') : 'Target';
                const hackMsg = await reply(`💻 Hacking ${target}... 0%`);
                if (hackMsg) {
                    setTimeout(async () => await sock.sendMessage(msg.key.remoteJid, { text: `💻 Hacking ${target}... 40%\nFetching IP address...`, edit: hackMsg.key }), 1500);
                    setTimeout(async () => await sock.sendMessage(msg.key.remoteJid, { text: `💻 Hacking ${target}... 80%\nBypassing firewall...`, edit: hackMsg.key }), 3000);
                    setTimeout(async () => await sock.sendMessage(msg.key.remoteJid, { text: `💻 Hacking ${target}... 100%\nSuccessfully hacked! (Just kidding 🤣)`, edit: hackMsg.key }), 4500);
                }
            } else if (cmd === 'joke') {
                const jokes = ["Why don't scientists trust atoms? Because they make up everything!", "What do you call a fake noodle? An impasta!", "Why did the scarecrow win an award? Because he was outstanding in his field!"];
                await reply(jokes[Math.floor(Math.random() * jokes.length)]);
            } else if (cmd === 'meme') {
                try {
                    const res = await axios.get('https://meme-api.com/gimme');
                    await sock.sendMessage(msg.key.remoteJid, { image: { url: res.data.url }, caption: res.data.title });
                } catch (e) {
                    await reply('❌ Failed to fetch a meme.');
                }
            } else if (cmd === 'ytmp3' || cmd === 'ytmp4') {
                await reply(`❌ Please use ${config.prefix}play instead.`, msg);
            } else if (cmd === 'ai' || cmd === 'gpt' || cmd === 'gemini') {
                if (args.length === 0) return await reply(`❌ Please provide a prompt. Example: ${config.prefix}ai What is the capital of France?`);
                const prompt = args.join(' ');
                await reply(`🧠 Thinking...`);
                
                const taskId = Math.random().toString(36).substring(7);
                aiTasks.push({
                    id: taskId,
                    prompt: prompt,
                    remoteJid: msg.key.remoteJid,
                    status: 'pending'
                });
            } else if (cmd === 'calc') {
                const expression = args.join(' ');
                try {
                    const result = eval(expression.replace(/[^0-9+\-*/().]/g, ''));
                    await reply(`🧮 *Résultat:* ${result}`, msg);
                } catch {
                    await reply(`❌ Expression invalide.`, msg);
                }
            } else if (cmd === 'tr' || cmd === 'translate') {
                if (args.length < 2) return await reply(`❌ Usage: ${config.prefix}tr <langue> <texte>`, msg);
                const lang = args[0];
                const textToTranslate = args.slice(1).join(' ');
                try {
                    const ai = getAi();
                    const response = await ai.models.generateContent({
                        model: 'gemini-3.1-flash-preview',
                        contents: `Translate the following text to ${lang}. Only return the translation, nothing else: "${textToTranslate}"`
                    });
                    await reply(`🌐 *Traduction (${lang}):*\n\n${response.text}`, msg);
                } catch (e) {
                    await reply(`❌ Échec de la traduction.`, msg);
                }
            } else if (cmd === 'pinterest') {
                if (args.length === 0) return await reply(`❌ Usage: ${config.prefix}pinterest <recherche>`, msg);
                const query = args.join(' ') + ' site:pinterest.com';
                await sock.sendMessage(msg.key.remoteJid, { react: { text: '⏳', key: msg.key } });
                
                gis(query, async (error: any, results: any[]) => {
                    if (error || !results || results.length === 0) {
                        return await reply(`❌ Aucune image trouvée pour "${args.join(' ')}".`, msg);
                    }
                    try {
                        // Get a random image from top 5 results
                        const randomResult = results[Math.floor(Math.random() * Math.min(5, results.length))];
                        await sock.sendMessage(msg.key.remoteJid, { 
                            image: { url: randomResult.url }, 
                            caption: `📌 *Pinterest:* ${args.join(' ')}` 
                        }, { quoted: msg });
                    } catch (e) {
                        await reply(`❌ Échec de l'envoi de l'image.`, msg);
                    }
                });
            } else if (cmd === 'wiki' || cmd === 'wikipedia') {
                if (args.length === 0) return await reply(`❌ Usage: ${config.prefix}wiki <recherche>`, msg);
                const query = args.join(' ');
                try {
                    const ai = getAi();
                    const response = await ai.models.generateContent({
                        model: 'gemini-3.1-flash-preview',
                        contents: `Fais un résumé court et précis (style Wikipedia) sur : ${query}`
                    });
                    await reply(`📚 *Wikipedia:*\n\n${response.text}`, msg);
                } catch (e) {
                    await reply(`❌ Échec de la recherche.`, msg);
                }
            } else if (cmd === 'lyrics') {
                if (args.length === 0) return await reply(`❌ Usage: ${config.prefix}lyrics <chanson>`, msg);
                const query = args.join(' ');
                try {
                    const ai = getAi();
                    const response = await ai.models.generateContent({
                        model: 'gemini-3.1-flash-preview',
                        contents: `Donne-moi les paroles de la chanson "${query}". Si tu ne trouves pas, dis-le.`
                    });
                    await reply(`🎤 *Paroles:*\n\n${response.text}`, msg);
                } catch (e) {
                    await reply(`❌ Échec de la recherche.`, msg);
                }
            } else if (cmd === 'github') {
                if (args.length === 0) return await reply(`❌ Usage: ${config.prefix}github <username>`, msg);
                try {
                    const res = await axios.get(`https://api.github.com/users/${args[0]}`);
                    const data = res.data;
                    const text = `🐙 *GitHub Info*\n\n👤 *Nom:* ${data.name || data.login}\n📝 *Bio:* ${data.bio || 'Aucune'}\n👥 *Abonnés:* ${data.followers}\n📦 *Dépôts publics:* ${data.public_repos}\n🔗 *Lien:* ${data.html_url}`;
                    await sock.sendMessage(msg.key.remoteJid, { image: { url: data.avatar_url }, caption: text }, { quoted: msg });
                } catch (e) {
                    await reply(`❌ Utilisateur introuvable.`, msg);
                }
            } else if (cmd === 'crypto') {
                if (args.length === 0) return await reply(`❌ Usage: ${config.prefix}crypto <coin>`, msg);
                try {
                    const res = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${args[0].toLowerCase()}&vs_currencies=usd`);
                    const price = res.data[args[0].toLowerCase()]?.usd;
                    if (price) {
                        await reply(`💰 *Prix de ${args[0].toUpperCase()}:* $${price}`, msg);
                    } else {
                        await reply(`❌ Crypto introuvable.`, msg);
                    }
                } catch (e) {
                    await reply(`❌ Échec de la récupération du prix.`, msg);
                }
            } else if (cmd === 'add') {
                if (!isGroup) return await reply('❌ Commande réservée aux groupes.', msg);
                if (args.length === 0) return await reply(`❌ Usage: ${config.prefix}add <number>`, msg);
                const target = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                try {
                    await sock.groupParticipantsUpdate(msg.key.remoteJid, [target], "add");
                    await reply(`✅ Utilisateur ajouté.`, msg);
                } catch (e) {
                    await reply(`❌ Échec de l'ajout.`, msg);
                }
            } else if (cmd === 'schedule') {
                if (!isGroup) return await reply('❌ Commande réservée aux groupes.', msg);
                if (!isFromMe) return await reply(`❌ Seul le propriétaire du bot peut utiliser cette commande.`, msg);
                
                const action = args[0]?.toLowerCase();
                const time = args[1]; // HH:MM
                
                if ((action !== 'open' && action !== 'close') || !time || !time.match(/^\d{2}:\d{2}$/)) {
                    return await reply(`❌ Usage: ${config.prefix}schedule <open|close> <HH:MM>`, msg);
                }

                const [hour, minute] = time.split(':');
                const cronTime = `${minute} ${hour} * * *`;
                
                schedule.scheduleJob(cronTime, async () => {
                    const setting = action === 'open' ? 'not_announcement' : 'announcement';
                    await sock.groupSettingUpdate(msg.key.remoteJid, setting);
                    await reply(`⏰ Le groupe a été ${action === 'open' ? 'ouvert' : 'fermé'} automatiquement.`);
                });

                await reply(`✅ Planification enregistrée : le groupe sera ${action === 'open' ? 'ouvert' : 'fermé'} tous les jours à ${time}.`, msg);
            } else if (cmd === 'poststatus') {
                if (!isFromMe) return await reply(`❌ Seul le propriétaire du bot peut utiliser cette commande.`, msg);
                if (args.length === 0) return await reply(`❌ Usage: ${config.prefix}poststatus <text>`, msg);
                await sock.sendMessage('status@broadcast', { text: args.join(' ') });
                await reply(`✅ Statut publié avec succès.`, msg);
            } else if (cmd === 'setname') {
                if (!isGroup) return await reply('❌ Commande réservée aux groupes.', msg);
                if (args.length === 0) return await reply(`❌ Usage: ${config.prefix}setname <nom>`, msg);
                await sock.groupUpdateSubject(msg.key.remoteJid, args.join(' '));
                await reply(`✅ Nom du groupe modifié.`, msg);
            } else if (cmd === 'setdesc') {
                if (!isGroup) return await reply('❌ Commande réservée aux groupes.', msg);
                if (args.length === 0) return await reply(`❌ Usage: ${config.prefix}setdesc <description>`, msg);
                await sock.groupUpdateDescription(msg.key.remoteJid, args.join(' '));
                await reply(`✅ Description du groupe modifiée.`, msg);
            } else if (cmd === 'link') {
                if (!isGroup) return await reply('❌ Commande réservée aux groupes.', msg);
                try {
                    const code = await sock.groupInviteCode(msg.key.remoteJid);
                    await reply(`🔗 *Lien du groupe:*\nhttps://chat.whatsapp.com/${code}`, msg);
                } catch (e) {
                    await reply(`❌ Je dois être admin pour avoir le lien.`, msg);
                }
            } else if (cmd === 'revoke') {
                if (!isGroup) return await reply('❌ Commande réservée aux groupes.', msg);
                try {
                    await sock.groupRevokeInvite(msg.key.remoteJid);
                    await reply(`✅ Lien du groupe réinitialisé.`, msg);
                } catch (e) {
                    await reply(`❌ Je dois être admin pour réinitialiser le lien.`, msg);
                }
            } else if (cmd === 'weather') {
                if (args.length === 0) return await reply(`❌ Please provide a city name. Example: ${config.prefix}weather Paris`);
                const city = args.join(' ');
                try {
                    const res = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=%l:+%C+%t,+%w,+%h+humidity`);
                    await reply(`🌤️ *Weather Info:*\n\n${res.data}`);
                } catch (e) {
                    await reply('❌ Failed to fetch weather data. Make sure the city name is correct.');
                }
            } else if (cmd === 'calc' || cmd === 'calculate' || cmd === 'math') {
                if (args.length === 0) return await reply(`❌ Please provide a math expression. Example: ${config.prefix}calc 5 * 10`);
                const expression = args.join(' ');
                try {
                    // Very basic and safe evaluation using Function instead of eval, though still has risks.
                    // A better approach is using a math library, but for simplicity:
                    const result = new Function(`return ${expression}`)();
                    await reply(`🧮 *Result:*\n${expression} = *${result}*`);
                } catch (e) {
                    await reply('❌ Invalid math expression.');
                }
            } else if (cmd === 'github') {
                if (args.length === 0) return await reply(`❌ Please provide a GitHub username. Example: ${config.prefix}github octocat`);
                const username = args[0];
                try {
                    const res = await axios.get(`https://api.github.com/users/${username}`);
                    const data = res.data;
                    const caption = `🐙 *GITHUB USER INFO* 🐙\n\n` +
                                    `👤 *Name:* ${data.name || data.login}\n` +
                                    `📝 *Bio:* ${data.bio || 'No bio'}\n` +
                                    `🏢 *Company:* ${data.company || 'None'}\n` +
                                    `📍 *Location:* ${data.location || 'Unknown'}\n` +
                                    `📦 *Public Repos:* ${data.public_repos}\n` +
                                    `👥 *Followers:* ${data.followers}\n` +
                                    `🔗 *Profile:* ${data.html_url}`;
                    await sock.sendMessage(msg.key.remoteJid, { image: { url: data.avatar_url }, caption: caption });
                } catch (e) {
                    await reply('❌ GitHub user not found.');
                }
            } else if (cmd === 'npm') {
                if (args.length === 0) return await reply(`❌ Please provide an NPM package name. Example: ${config.prefix}npm express`);
                const pkg = args[0];
                try {
                    const res = await axios.get(`https://registry.npmjs.org/${pkg}`);
                    const data = res.data;
                    const latestVersion = data['dist-tags'].latest;
                    const latestData = data.versions[latestVersion];
                    const caption = `📦 *NPM PACKAGE INFO* 📦\n\n` +
                                    `🏷️ *Name:* ${data.name}\n` +
                                    `📌 *Version:* ${latestVersion}\n` +
                                    `📝 *Description:* ${data.description || 'No description'}\n` +
                                    `👨‍💻 *Author:* ${latestData.author?.name || 'Unknown'}\n` +
                                    `⚖️ *License:* ${latestData.license || 'Unknown'}\n` +
                                    `🔗 *Link:* https://www.npmjs.com/package/${data.name}`;
                    await reply(caption);
                } catch (e) {
                    await reply('❌ NPM package not found.');
                }
            } else if (cmd === 'translate') {
                if (args.length < 2) return await reply(`❌ Please provide a target language code and text. Example: ${config.prefix}translate fr Hello world`);
                const targetLang = args[0];
                const textToTranslate = args.slice(1).join(' ');
                try {
                    const res = await axios.get(`https://api.popcat.xyz/translate?to=${targetLang}&text=${encodeURIComponent(textToTranslate)}`);
                    await reply(`🌐 *TRANSLATION*\n\n*Original:* ${textToTranslate}\n*Translated (${targetLang}):* ${res.data.translated}`);
                } catch (e) {
                    await reply('❌ Failed to translate text. Make sure the language code is valid (e.g., fr, es, de).');
                }
            } else if (cmd === 'waifu') {
                try {
                    const res = await axios.get('https://api.waifu.pics/sfw/waifu');
                    const url = res.data.url;
                    if (url.endsWith('.gif')) {
                        await sock.sendMessage(msg.key.remoteJid, { video: { url }, gifPlayback: true, caption: '🌸 Here is your waifu!' });
                    } else {
                        await sock.sendMessage(msg.key.remoteJid, { image: { url }, caption: '🌸 Here is your waifu!' });
                    }
                } catch (e) {
                    await reply('❌ Failed to fetch waifu image.');
                }
            } else if (['neko', 'husbando', 'kitsune', 'hug', 'kiss', 'pat', 'slap', 'cuddle', 'cry', 'smug', 'bonk', 'yeet', 'blush', 'smile', 'wave', 'highfive', 'handhold', 'nom', 'bite', 'glare', 'bully', 'poke', 'wink', 'dance', 'cringe', 'megumin', 'awoo'].includes(cmd || '')) {
                try {
                    // Map some commands to valid waifu.pics endpoints if they differ
                    let endpoint = cmd;
                    if (cmd === 'husbando') endpoint = 'waifu'; // fallback as husbando isn't standard sfw
                    if (cmd === 'kitsune') endpoint = 'neko'; // fallback
                    
                    const res = await axios.get(`https://api.waifu.pics/sfw/${endpoint}`);
                    const url = res.data.url;
                    
                    if (url.endsWith('.gif')) {
                        // Convert GIF to animated sticker so it plays correctly on WhatsApp
                        const sticker = new Sticker(url, {
                            pack: 'Vortex-MD',
                            author: 'Samy Charles',
                            type: StickerTypes.FULL,
                            quality: 50
                        });
                        const buffer = await sticker.toBuffer();
                        await sock.sendMessage(msg.key.remoteJid, { sticker: buffer }, { quoted: msg });
                    } else {
                        await sock.sendMessage(msg.key.remoteJid, { image: { url }, caption: `✨ ${cmd} ✨` }, { quoted: msg });
                    }
                } catch (e) {
                    await reply(`❌ Failed to fetch ${cmd} image.`);
                }
            }
        }
    } catch (err: any) {
        const errMsg = err?.message || '';
        const errStack = err?.stack || '';
        const fullErr = (errMsg + ' ' + errStack).toLowerCase();
        
        if (fullErr.includes('bad mac') || fullErr.includes('decryption') || fullErr.includes('failed to decrypt') || fullErr.includes('messagecountererror') || fullErr.includes('key used already')) {
            // Log as warning first
            console.warn(`[${sessionId}] Decryption/MAC error detected: ${errMsg}`);
            session.decryptionErrors++;
            
            // If it's a Bad MAC, we should probably restart sooner
            const isBadMac = fullErr.includes('bad mac');
            const threshold = isBadMac ? 3 : 10;

            if (session.decryptionErrors >= threshold) {
                console.log(`[${sessionId}] Too many decryption errors (${session.decryptionErrors}) or Bad MAC detected. Forcing session reset...`);
                try {
                    if (session.sock) {
                        session.sock.end();
                    }
                } catch (e) {}
                
                // We don't necessarily delete the session immediately, 
                // but we force a reconnect which might fix it.
                // If it still fails, the connection.update logic will handle the full deletion.
                setTimeout(() => startBot(sessionId), 1000);
                
                // Reset counter after triggering reconnect
                session.decryptionErrors = 0;
            }
        } else if (!fullErr.includes('connection closed') && !fullErr.includes('not connected')) {
            console.error('Error in messages.upsert:', err);
        }
    }
});

    if (phoneNumber && !sock.authState.creds.registered) {
        session.status = 'connecting';
        try {
            // Wait a bit before requesting pairing code
            await new Promise(resolve => setTimeout(resolve, 2000));
            const code = await sock.requestPairingCode(phoneNumber);
            return code;
        } catch (err) {
            console.error('Error requesting pairing code:', err);
            session.status = 'disconnected';
            throw err;
        }
    } else if (sock.authState.creds.registered) {
        session.status = 'connecting';
    }

    return null;
}

// Auto-start existing sessions
const sessionsDir = path.join(process.cwd(), 'sessions');
if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir);
}
fs.readdirSync(sessionsDir).forEach(dir => {
    if (fs.statSync(path.join(sessionsDir, dir)).isDirectory()) {
        startBot(dir).catch(console.error);
    }
});

app.get('/api/stats', (req, res) => {
    let connectedCount = 0;
    sessions.forEach(session => {
        if (session.status === 'connected') connectedCount++;
    });
    res.json({ connectedCount });
});

app.post('/api/pair', async (req, res) => {
  const { phoneNumber, force, config } = req.body;
  if (!phoneNumber) {
      res.status(400).json({ error: 'Phone number required' });
      return;
  }
  
  try {
    const sessionId = phoneNumber.replace(/[^0-9]/g, '');
    
    // Save config if provided
    if (config) {
        const currentConfig = getConfig(sessionId);
        if (config.prefix !== undefined) currentConfig.prefix = config.prefix;
        if (config.autoreact !== undefined) currentConfig.autoreact = config.autoreact;
        if (config.autostatus !== undefined) currentConfig.autostatus = config.autostatus;
        if (config.autostatusEmoji !== undefined) currentConfig.autostatusEmoji = config.autostatusEmoji;
        saveConfig(sessionId, currentConfig);
    }
    
    if (force) {
        const session = sessions.get(sessionId);
        if (session && session.sock) {
            try { session.sock.end(undefined); } catch (e) {}
        }
        const sessionPath = path.join(process.cwd(), `sessions/${sessionId}`);
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }
        sessions.delete(sessionId);
    }

    const code = await startBot(sessionId, phoneNumber);
    res.json({ code, sessionId });
  } catch (err: any) {
    console.error('Pairing error:', err);
    let errorMessage = err.message;
    if (errorMessage === '1') errorMessage = 'Connection failed (Error 1). Please try again in a few seconds.';
    res.status(500).json({ error: errorMessage || 'Unknown pairing error' });
  }
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.get('/api/config', (req, res) => {
    const phone = req.query.phone as string;
    if (!phone) return res.status(400).json({ error: 'Phone number required' });
    res.json(getConfig(phone));
});

app.get('/api/ai-tasks', (req, res) => {
    const pendingTasks = aiTasks.filter(t => t.status === 'pending');
    // Mark as processing so they aren't picked up twice
    pendingTasks.forEach(t => t.status = 'processing');
    res.json(pendingTasks);
});

app.post('/api/ai-tasks/:id', async (req, res) => {
    const { id } = req.params;
    const { result, error } = req.body;
    
    const task = aiTasks.find(t => t.id === id);
    if (task) {
        task.status = error ? 'failed' : 'completed';
        // We don't have the specific session here, so we broadcast to all connected sessions
        // In a real app, we'd store the sessionId in the task
        for (const session of sessions.values()) {
            if (session.status === 'connected' && session.sock && task.remoteJid) {
                try {
                    if (error) {
                        await session.sock.sendMessage(task.remoteJid, { text: '❌ An error occurred while generating AI response.' });
                    } else {
                        await session.sock.sendMessage(task.remoteJid, { text: result || 'No response generated.' });
                    }
                } catch (e) {
                    console.error('Failed to send AI response:', e);
                }
            }
        }
        // Remove task after completion
        const index = aiTasks.indexOf(task);
        if (index > -1) aiTasks.splice(index, 1);
    }
    res.json({ success: true });
});

app.post('/api/config', (req, res) => {
    const phone = req.query.phone as string;
    if (!phone) return res.status(400).json({ error: 'Phone number required' });
    const { prefix, mode, autostatus, autostatusEmoji } = req.body;
    const config = getConfig(phone);
    if (prefix !== undefined) config.prefix = prefix;
    if (mode !== undefined) config.mode = mode;
    if (autostatus !== undefined) config.autostatus = autostatus;
    if (autostatusEmoji !== undefined) config.autostatusEmoji = autostatusEmoji;
    saveConfig(phone, config);
    res.json({ success: true, config });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    app.get('*', (req, res) => {
        res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // Start heartbeat logging
    setInterval(() => {
        const activeSessions = Array.from(sessions.values()).filter(s => s.status === 'connected').length;
        console.log(`[Heartbeat] ${new Date().toISOString()} - Server is alive. Active sessions: ${activeSessions}/${sessions.size}`);
    }, 15 * 60 * 1000);

    // Auto-restart existing sessions
    autoRestartSessions().catch(err => {
        console.error('[AutoRestart] Global error:', err);
    });
  }).on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
          console.error(`Port ${PORT} is already in use. Attempting to recover...`);
          // The platform will handle the restart if we exit
          process.exit(1);
      } else {
          console.error('Server error:', err);
      }
  });
}

// Prevent server from crashing
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

startServer();
