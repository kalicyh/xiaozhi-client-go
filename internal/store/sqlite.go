package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"

	_ "modernc.org/sqlite"
)

type DB struct { path string; mu sync.Mutex; db *sql.DB }

func Open(path string) (*DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout=5000&_pragma=journal_mode=WAL", path)
	database, err := sql.Open("sqlite", dsn); if err != nil { return nil, err }
	if err = database.Ping(); err != nil { return nil, err }
	d := &DB{path: path, db: database}
	if err := d.migrate(); err != nil { return nil, err }
	return d, nil
}

func (d *DB) migrate() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS sessions( id TEXT PRIMARY KEY, transport TEXT, created_at INTEGER );`,
		`CREATE TABLE IF NOT EXISTS messages( id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, direction TEXT, type TEXT, payload TEXT, created_at INTEGER, FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE );`,
	}
	for _, s := range stmts { if _, err := d.db.Exec(s); err != nil { return err } }
	return nil
}

func (d *DB) Close() error { return d.db.Close() }

func (d *DB) SaveSession(ctx context.Context, id, transport string, ts int64) error {
	_, err := d.db.ExecContext(ctx, `INSERT OR IGNORE INTO sessions(id,transport,created_at) VALUES(?,?,?)`, id, transport, ts); return err
}

func (d *DB) SaveMessage(ctx context.Context, sessionID, direction, typ, payload string, ts int64) error {
	if sessionID == "" { return errors.New("empty session") }
	_, err := d.db.ExecContext(ctx, `INSERT INTO messages(session_id,direction,type,payload,created_at) VALUES(?,?,?,?,?)`, sessionID, direction, typ, payload, ts)
	return err
}

type Message struct { SessionID string `json:"session_id"`; Direction string `json:"direction"`; Type string `json:"type"`; Payload string `json:"payload"`; CreatedAt int64 `json:"created_at"` }

func (d *DB) RecentMessages(ctx context.Context, limit int) ([]Message, error) {
	rows, err := d.db.QueryContext(ctx, `SELECT session_id,direction,type,payload,created_at FROM messages ORDER BY id DESC LIMIT ?`, limit)
	if err != nil { return nil, err }
	defer rows.Close()
	var out []Message
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.SessionID, &m.Direction, &m.Type, &m.Payload, &m.CreatedAt); err != nil { return nil, err }
		out = append(out, m)
	}
	return out, rows.Err()
}
