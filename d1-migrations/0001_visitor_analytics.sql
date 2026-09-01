-- Visitor analytics is intentionally separate from Ask Nhân. These tables must
-- never receive a question, answer, model prompt, credential, or chat log.

CREATE TABLE visitor_daily (
  day_local TEXT NOT NULL,
  ip_address TEXT NOT NULL CHECK (length(ip_address) BETWEEN 3 AND 45),
  first_seen_utc TEXT NOT NULL,
  last_seen_utc TEXT NOT NULL,
  page_views INTEGER NOT NULL DEFAULT 1 CHECK (page_views >= 1),
  country TEXT NOT NULL DEFAULT '' CHECK (length(country) <= 2),
  region TEXT NOT NULL DEFAULT '' CHECK (length(region) <= 80),
  city TEXT NOT NULL DEFAULT '' CHECK (length(city) <= 80),
  asn INTEGER NOT NULL DEFAULT 0 CHECK (asn >= 0),
  as_organization TEXT NOT NULL DEFAULT '' CHECK (length(as_organization) <= 120),
  colo TEXT NOT NULL DEFAULT '' CHECK (length(colo) <= 3),
  device_class TEXT NOT NULL CHECK (device_class IN ('bot', 'desktop', 'mobile', 'tablet', 'unknown')),
  browser_family TEXT NOT NULL CHECK (browser_family IN ('bot', 'chrome', 'edge', 'firefox', 'opera', 'other', 'safari', 'samsung', 'unknown')),
  first_path TEXT NOT NULL CHECK (first_path IN ('/en', '/vi')),
  last_path TEXT NOT NULL CHECK (last_path IN ('/en', '/vi')),
  first_referrer_host TEXT NOT NULL DEFAULT '' CHECK (length(first_referrer_host) <= 253),
  last_referrer_host TEXT NOT NULL DEFAULT '' CHECK (length(last_referrer_host) <= 253),
  campaign_source TEXT NOT NULL DEFAULT '' CHECK (length(campaign_source) <= 64),
  campaign_medium TEXT NOT NULL DEFAULT '' CHECK (length(campaign_medium) <= 64),
  campaign_name TEXT NOT NULL DEFAULT '' CHECK (length(campaign_name) <= 64),
  PRIMARY KEY (day_local, ip_address)
) WITHOUT ROWID;

CREATE INDEX visitor_daily_last_seen_idx
  ON visitor_daily (last_seen_utc DESC);

CREATE INDEX visitor_daily_ip_idx
  ON visitor_daily (ip_address);

CREATE TABLE owner_ips (
  ip_address TEXT PRIMARY KEY NOT NULL CHECK (length(ip_address) BETWEEN 3 AND 45),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  added_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE daily_visit_summaries (
  day_local TEXT PRIMARY KEY NOT NULL,
  total_unique_ips INTEGER NOT NULL CHECK (total_unique_ips >= 0),
  owner_unique_ips INTEGER NOT NULL CHECK (owner_unique_ips >= 0),
  external_unique_ips INTEGER NOT NULL CHECK (external_unique_ips >= 0),
  total_page_views INTEGER NOT NULL CHECK (total_page_views >= 0),
  owner_page_views INTEGER NOT NULL CHECK (owner_page_views >= 0),
  external_page_views INTEGER NOT NULL CHECK (external_page_views >= 0),
  generated_at_utc TEXT NOT NULL
) WITHOUT ROWID;
