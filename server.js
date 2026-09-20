// Akbarita Chat - server.js
// Real-time username-based chat (no login/password), 1:1 + groups,
// text / image / voice messages, JSON-file persistence.

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- Simple JSON persistence ----------
function loadDB() {
  if (fs.existsSync(DB_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      console.error('Failed to parse db.json, starting fresh:', e);
    }
  }
  return { users: {}, conversations: {} };
  // users: { usernameLower: { username, createdAt } }
  // conversations: { convId: { type: 'dm'|'group', name, members: [usernames], messages: [...] } }
}

let db = loadDB();
let saveTimer = null;
function saveDB() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), (err) => {
      if (err) console.error('Error saving db:', err);
    });
  }, 150);
}

function dmConvId(userA, userB) {
  return 'dm:' + [userA.toLowerCase(), userB.toLowerCase()].sort().join('|');
}

function ensureConversation(id, data) {
  if (!db.conversations[id]) {
    db.conversations[id] = data;
    saveDB();
  }
  return db.conversations[id];
}

// ---------- Express setup ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 15 * 1024 * 1024 });

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || (
        file.mimetype.includes('webm') ? '.webm' :
        file.mimetype.includes('png') ? '.png' :
        file.mimetype.includes('jpeg') ? '.jpg' : ''
      );
      cb(null, uuidv4() + ext);
    }
  }),
  limits: { fileSize: 12 * 1024 * 1024 }
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  res.json({ url: '/uploads/' + req.file.filename, mimetype: req.file.mimetype });
});

// ---------- Socket.IO ----------
// socket -> username (lowercase key for lookups)
const onlineSockets = new Map(); // username(lower) -> Set(socket.id)

function isUsernameTaken(username) {
  return !!db.users[username.toLowerCase()];
}

function sendToUser(username, event, payload) {
  const set = onlineSockets.get(username.toLowerCase());
  if (set) {
    for (const sockId of set) {
      io.to(sockId).emit(event, payload);
    }
  }
}

function userConversationsList(username) {
  const lower = username.toLowerCase();
  const list = [];
  for (const [id, conv] of Object.entries(db.conversations)) {
    if (conv.members.map(m => m.toLowerCase()).includes(lower)) {
      const last = conv.messages[conv.messages.length - 1] || null;
      list.push({
        id,
        type: conv.type,
        name: conv.type === 'group' ? conv.name : conv.members.find(m => m.toLowerCase() !== lower) || conv.name,
        members: conv.members,
        lastMessage: last,
      });
    }
  }
  list.sort((a, b) => {
    const ta = a.lastMessage ? a.lastMessage.ts : 0;
    const tb = b.lastMessage ? b.lastMessage.ts : 0;
    return tb - ta;
  });
  return list;
}

io.on('connection', (socket) => {
  let currentUser = null;

  socket.on('register', (username, cb) => {
    if (typeof username !== 'string') return cb({ ok: false, error: 'invalid' });
    username = username.trim();
    if (!/^[a-zA-Z0-9_\u0600-\u06FF]{2,20}$/.test(username)) {
      return cb({ ok: false, error: 'format' });
    }
    if (isUsernameTaken(username)) {
      return cb({ ok: false, error: 'taken' });
    }
    db.users[username.toLowerCase()] = { username, createdAt: Date.now() };
    saveDB();
    currentUser = username;
    if (!onlineSockets.has(username.toLowerCase())) onlineSockets.set(username.toLowerCase(), new Set());
    onlineSockets.get(username.toLowerCase()).add(socket.id);
    cb({ ok: true, username });
  });

  socket.on('login', (username, cb) => {
    // Rejoin with an existing username (no password by design)
    if (typeof username !== 'string') return cb({ ok: false, error: 'invalid' });
    username = username.trim();
    const rec = db.users[username.toLowerCase()];
    if (!rec) return cb({ ok: false, error: 'not_found' });
    currentUser = rec.username;
    if (!onlineSockets.has(username.toLowerCase())) onlineSockets.set(username.toLowerCase(), new Set());
    onlineSockets.get(username.toLowerCase()).add(socket.id);
    cb({ ok: true, username: rec.username });
  });

  socket.on('check_username', (username, cb) => {
    cb({ taken: isUsernameTaken((username || '').trim()) });
  });

  socket.on('get_conversations', (cb) => {
    if (!currentUser) return cb({ ok: false, error: 'not_registered' });
    cb({ ok: true, conversations: userConversationsList(currentUser) });
  });

  socket.on('open_dm', ({ withUsername }, cb) => {
    if (!currentUser) return cb({ ok: false, error: 'not_registered' });
    withUsername = (withUsername || '').trim();
    if (!withUsername) return cb({ ok: false, error: 'invalid' });
    if (withUsername.toLowerCase() === currentUser.toLowerCase()) return cb({ ok: false, error: 'self' });
    if (!db.users[withUsername.toLowerCase()]) return cb({ ok: false, error: 'no_such_user' });
    const id = dmConvId(currentUser, withUsername);
    const conv = ensureConversation(id, {
      type: 'dm',
      name: null,
      members: [currentUser, db.users[withUsername.toLowerCase()].username],
      messages: []
    });
    cb({ ok: true, id, conversation: conv });
  });

  socket.on('create_group', ({ name, members }, cb) => {
    if (!currentUser) return cb({ ok: false, error: 'not_registered' });
    name = (name || '').trim();
    if (!name) return cb({ ok: false, error: 'invalid_name' });
    const validMembers = [currentUser];
    for (const m of (members || [])) {
      const mm = (m || '').trim();
      if (mm && db.users[mm.toLowerCase()] && mm.toLowerCase() !== currentUser.toLowerCase()) {
        validMembers.push(db.users[mm.toLowerCase()].username);
      }
    }
    const id = 'group:' + uuidv4();
    db.conversations[id] = { type: 'group', name, members: validMembers, messages: [] };
    saveDB();
    for (const m of validMembers) {
      sendToUser(m, 'conversation_created', { id, conversation: db.conversations[id] });
    }
    cb({ ok: true, id, conversation: db.conversations[id] });
  });

  socket.on('get_messages', ({ convId }, cb) => {
    if (!currentUser) return cb({ ok: false, error: 'not_registered' });
    const conv = db.conversations[convId];
    if (!conv || !conv.members.map(m => m.toLowerCase()).includes(currentUser.toLowerCase())) {
      return cb({ ok: false, error: 'not_member' });
    }
    cb({ ok: true, messages: conv.messages });
  });

  socket.on('send_message', ({ convId, type, content }, cb) => {
    if (!currentUser) return cb({ ok: false, error: 'not_registered' });
    const conv = db.conversations[convId];
    if (!conv || !conv.members.map(m => m.toLowerCase()).includes(currentUser.toLowerCase())) {
      return cb({ ok: false, error: 'not_member' });
    }
    if (!['text', 'image', 'voice'].includes(type)) return cb({ ok: false, error: 'bad_type' });
    if (!content) return cb({ ok: false, error: 'empty' });

    const msg = {
      id: uuidv4(),
      from: currentUser,
      type,
      content, // text string OR uploaded file URL
      ts: Date.now()
    };
    conv.messages.push(msg);
    if (conv.messages.length > 2000) conv.messages.shift(); // basic cap
    saveDB();

    for (const member of conv.members) {
      sendToUser(member, 'new_message', { convId, message: msg });
    }
    cb({ ok: true, message: msg });
  });

  socket.on('disconnect', () => {
    if (currentUser) {
      const set = onlineSockets.get(currentUser.toLowerCase());
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) onlineSockets.delete(currentUser.toLowerCase());
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Akbarita Chat server running on http://localhost:${PORT}`);
});
