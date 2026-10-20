-- ────────────────────────────────────────────────────────────
-- memo v2 · 数据库结构
-- 执行：npx wrangler d1 execute kilo --remote --file=./schema.sql
-- ────────────────────────────────────────────────────────────

-- 用户。pw_hash 为 NULL 表示「还没设密码」，需要用邀请码激活。
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,          -- 登录名，小写字母数字下划线
  display_name  TEXT    NOT NULL,                 -- 显示名
  bio           TEXT    NOT NULL DEFAULT '',
  avatar_key    TEXT,                             -- 对象存储 key（历史字段；头像现在存 avatar_data）
  avatar_data   TEXT,                             -- 头像本身：data:image/...;base64, 存在库里，不依赖对象存储
  role          TEXT    NOT NULL DEFAULT 'user',  -- admin | user
  pw_hash       TEXT,
  pw_salt       TEXT,
  pw_iter       INTEGER NOT NULL DEFAULT 50000,
  session_ver   INTEGER NOT NULL DEFAULT 1,       -- 改密码就 +1，旧会话全部失效
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 邀请码：管理员建号后发一个，用户拿它自己设密码
CREATE TABLE IF NOT EXISTS invites (
  code       TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  used_at    INTEGER,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invites_user ON invites(user_id);

-- 笔记。images 是 JSON 数组：[{"k":"i/202610/xx.webp","w":1600,"h":1200}]
CREATE TABLE IF NOT EXISTS notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  content    TEXT    NOT NULL DEFAULT '',
  images     TEXT    NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER,
  pinned     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notes_time ON notes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id, created_at DESC);

-- 评论
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id    INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_note ON comments(note_id, created_at);

-- 图片元数据。文件本体在 KV / B2 / R2（由 settings.image_storage 决定），这里只记索引，用于统计、限速、删除
CREATE TABLE IF NOT EXISTS images (
  key        TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  mime       TEXT    NOT NULL,
  size       INTEGER NOT NULL,
  w          INTEGER,
  h          INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_images_user ON images(user_id, created_at DESC);

-- 站点配置，全是 key-value
CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
