package store

import "context"

func (d *DB) InitConfig() error {
	_, err := d.db.Exec(`CREATE TABLE IF NOT EXISTS config ( key TEXT PRIMARY KEY, value TEXT )`)
	return err
}

func (d *DB) SetConfig(ctx context.Context, kv map[string]string) error {
	tx, err := d.db.BeginTx(ctx, nil); if err != nil { return err }
	stmt, err := tx.PrepareContext(ctx, `INSERT INTO config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
	if err != nil { _ = tx.Rollback(); return err }
	defer stmt.Close()
	for k, v := range kv { if _, err := stmt.ExecContext(ctx, k, v); err != nil { _ = tx.Rollback(); return err } }
	return tx.Commit()
}

func (d *DB) GetConfig(ctx context.Context) (map[string]string, error) {
	rows, err := d.db.QueryContext(ctx, `SELECT key,value FROM config`); if err != nil { return nil, err }
	defer rows.Close()
	m := make(map[string]string)
	for rows.Next() { var k, v string; if err := rows.Scan(&k, &v); err != nil { return nil, err }; m[k] = v }
	return m, rows.Err()
}

// DeleteConfig 删除指定 key
func (d *DB) DeleteConfig(ctx context.Context, key string) error {
	_, err := d.db.ExecContext(ctx, `DELETE FROM config WHERE key = ?`, key)
	return err
}

// ClearConfig 清空所有配置
func (d *DB) ClearConfig(ctx context.Context) error {
	_, err := d.db.ExecContext(ctx, `DELETE FROM config`)
	return err
}
