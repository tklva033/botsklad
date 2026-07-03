CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role_id TEXT NOT NULL REFERENCES roles(id),
  telegram_id BIGINT UNIQUE,
  telegram_username TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS racks (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (warehouse_id, code)
);

CREATE TABLE IF NOT EXISTS shelves (
  id TEXT PRIMARY KEY,
  rack_id TEXT NOT NULL REFERENCES racks(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rack_id, code)
);

CREATE TABLE IF NOT EXISTS cells (
  id TEXT PRIMARY KEY,
  shelf_id TEXT NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  barcode TEXT,
  full_code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shelf_id, code)
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  qr_code TEXT UNIQUE,
  barcode TEXT UNIQUE,
  category_id TEXT REFERENCES categories(id),
  supplier_id TEXT REFERENCES suppliers(id),
  unit TEXT NOT NULL DEFAULT 'pcs',
  min_stock NUMERIC(14,3) NOT NULL DEFAULT 0,
  photo_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_photos (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  cell_id TEXT NOT NULL REFERENCES cells(id) ON DELETE CASCADE,
  quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, cell_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  movement_type TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity NUMERIC(14,3) NOT NULL,
  from_cell_id TEXT REFERENCES cells(id),
  to_cell_id TEXT REFERENCES cells(id),
  performed_by TEXT REFERENCES users(id),
  comment TEXT,
  reference_code TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_history (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  cell_id TEXT NOT NULL REFERENCES cells(id),
  movement_id TEXT REFERENCES stock_movements(id) ON DELETE SET NULL,
  previous_quantity NUMERIC(14,3) NOT NULL,
  new_quantity NUMERIC(14,3) NOT NULL,
  change_quantity NUMERIC(14,3) NOT NULL,
  changed_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  movement_id TEXT NOT NULL UNIQUE REFERENCES stock_movements(id) ON DELETE CASCADE,
  supplier_id TEXT REFERENCES suppliers(id),
  warehouse_id TEXT REFERENCES warehouses(id),
  document_number TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  movement_id TEXT NOT NULL UNIQUE REFERENCES stock_movements(id) ON DELETE CASCADE,
  issued_to TEXT,
  request_number TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS issue_requests (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  requested_qty NUMERIC(14,3) NOT NULL,
  preferred_cell_id TEXT REFERENCES cells(id),
  requested_by TEXT REFERENCES users(id),
  approved_by TEXT REFERENCES users(id),
  fulfilled_issue_id TEXT REFERENCES issues(id),
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'pending',
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY,
  movement_id TEXT UNIQUE REFERENCES stock_movements(id) ON DELETE CASCADE,
  cell_id TEXT NOT NULL REFERENCES cells(id),
  expected_qty NUMERIC(14,3) NOT NULL,
  actual_qty NUMERIC(14,3) NOT NULL,
  diff_qty NUMERIC(14,3) NOT NULL,
  status TEXT NOT NULL,
  checked_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  product_id TEXT REFERENCES products(id),
  warehouse_id TEXT REFERENCES warehouses(id),
  cell_id TEXT REFERENCES cells(id),
  message TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_action_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  action_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS background_jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_supplier_id ON products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_inventory_product_id ON inventory(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_cell_id ON inventory(cell_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product_id ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_history_product_id ON inventory_history(product_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_user_action_logs_user_id ON user_action_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_issue_requests_status ON issue_requests(status);
CREATE INDEX IF NOT EXISTS idx_background_jobs_status_run_at ON background_jobs(status, run_at);

INSERT INTO roles (id, code, name, permissions)
VALUES
  ('role-admin', 'admin', 'Администратор', '["search","stock","receipt","issue","move","audit","reports","manage","settings"]'::jsonb),
  ('role-supervisor', 'supervisor', 'Руководитель', '["search","stock","reports"]'::jsonb),
  ('role-keeper', 'keeper', 'Кладовщик', '["search","stock","receipt","issue","move","audit"]'::jsonb),
  ('role-auditor', 'auditor', 'Ревизор', '["search","stock","audit","reports"]'::jsonb)
ON CONFLICT (id) DO UPDATE
SET code = EXCLUDED.code,
    name = EXCLUDED.name,
    permissions = EXCLUDED.permissions;

UPDATE roles
SET name = 'Администратор',
    permissions = '["search","stock","receipt","issue","move","audit","reports","manage","settings","request_create","request_approve","request_fulfill","admin_panel","import_export","upload_media"]'::jsonb
WHERE code = 'admin';

UPDATE roles
SET name = 'Руководитель',
    permissions = '["search","stock","reports","request_approve","admin_panel"]'::jsonb
WHERE code = 'supervisor';

UPDATE roles
SET name = 'Кладовщик',
    permissions = '["search","stock","receipt","issue","move","audit","request_create","request_fulfill","upload_media"]'::jsonb
WHERE code = 'keeper';

UPDATE roles
SET name = 'Ревизор',
    permissions = '["search","stock","audit","reports"]'::jsonb
WHERE code = 'auditor';
INSERT INTO users (id, phone, full_name, role_id, telegram_id, telegram_username, is_active)
SELECT
  'user-bot-admin',
  '+10000000000',
  'Bot Admin',
  'role-admin',
  NULL,
  NULL,
  TRUE
WHERE NOT EXISTS (
  SELECT 1
  FROM users
  WHERE is_active = TRUE
);
