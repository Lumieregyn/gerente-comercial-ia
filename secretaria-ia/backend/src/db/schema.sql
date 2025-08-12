CREATE TABLE IF NOT EXISTS brands (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS representatives (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT
);

CREATE TABLE IF NOT EXISTS rep_brands (
  rep_id INTEGER REFERENCES representatives(id) ON DELETE CASCADE,
  brand_id INTEGER REFERENCES brands(id) ON DELETE CASCADE,
  PRIMARY KEY (rep_id, brand_id)
);

CREATE TABLE IF NOT EXISTS solicitations (
  id SERIAL PRIMARY KEY,
  rep_id INTEGER REFERENCES representatives(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  frequency_minutes INTEGER NOT NULL,
  next_run TIMESTAMP NOT NULL DEFAULT NOW()
);
