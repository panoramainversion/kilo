-- 已有数据库升级：用户自定义头衔
-- 执行：npx wrangler d1 execute memo2 --remote --file=./migrations/20261021_user_titles.sql
ALTER TABLE users ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN title_color TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN title_on INTEGER NOT NULL DEFAULT 0;
