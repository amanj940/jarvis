"""SQLite store for the e-commerce team — local cache only.

All data lives in ``data/ecommerce.db`` (next to the memory DB). Nothing
here touches the network, and nothing here pushes anything back to a
store: rows are a read cache populated by the draft sync tool from
Shopify, plus revenue snapshots. Money is stored as REAL in major units
(dollars/euros) with the currency beside it.
"""
from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS ecommerce_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    remote_id TEXT NOT NULL UNIQUE,
    shop TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    vendor TEXT NOT NULL DEFAULT '',
    product_type TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT '',
    inventory INTEGER NOT NULL DEFAULT 0,
    variants INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL DEFAULT '{}',
    synced_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS ecommerce_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    remote_id TEXT NOT NULL UNIQUE,
    shop TEXT NOT NULL DEFAULT '',
    order_number TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    total REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT '',
    financial_status TEXT NOT NULL DEFAULT '',
    fulfillment_status TEXT NOT NULL DEFAULT '',
    customer_name TEXT NOT NULL DEFAULT '',
    customer_email TEXT NOT NULL DEFAULT '',
    line_items INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL DEFAULT '{}',
    synced_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS ecommerce_customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    remote_id TEXT NOT NULL UNIQUE,
    shop TEXT NOT NULL DEFAULT '',
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    orders_count INTEGER NOT NULL DEFAULT 0,
    total_spent REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL DEFAULT '{}',
    synced_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS ecommerce_sync_state (
    shop TEXT NOT NULL,
    resource TEXT NOT NULL,
    last_synced_at REAL NOT NULL,
    last_count INTEGER NOT NULL DEFAULT 0,
    last_errors INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (shop, resource)
);
CREATE INDEX IF NOT EXISTS idx_products_shop ON ecommerce_products(shop);
CREATE INDEX IF NOT EXISTS idx_products_status ON ecommerce_products(status);
CREATE INDEX IF NOT EXISTS idx_orders_shop ON ecommerce_orders(shop);
CREATE INDEX IF NOT EXISTS idx_orders_number ON ecommerce_orders(order_number);
CREATE INDEX IF NOT EXISTS idx_customers_shop ON ecommerce_customers(shop);
CREATE INDEX IF NOT EXISTS idx_customers_email ON ecommerce_customers(email);
"""


class EcommerceStore:
    """SQLite-backed e-commerce cache. Takes a plain path so tests can use tmp dirs."""

    # Columns added after the first release. ``CREATE TABLE IF NOT EXISTS``
    # never touches an existing table, so old databases get them here.
    _SYNC_STATE_MIGRATIONS = (
        ("last_errors", "INTEGER NOT NULL DEFAULT 0"),
        ("last_error", "TEXT NOT NULL DEFAULT ''"),
    )

    def __init__(self, db_path: str | Path):
        self.path = Path(db_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as c:
            c.executescript(SCHEMA)
            existing = {r[1] for r in
                        c.execute("PRAGMA table_info(ecommerce_sync_state)")}
            for col, decl in self._SYNC_STATE_MIGRATIONS:
                if col not in existing:
                    c.execute(f"ALTER TABLE ecommerce_sync_state "
                              f"ADD COLUMN {col} {decl}")

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    # ---- products ----
    def upsert_product(self, product: dict, shop: str = "") -> dict:
        now = time.time()
        with self._conn() as c:
            c.execute(
                "INSERT INTO ecommerce_products(remote_id, shop, title, vendor,"
                " product_type, status, price, currency, inventory, variants,"
                " payload, synced_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"
                " ON CONFLICT(remote_id) DO UPDATE SET"
                " shop=excluded.shop, title=excluded.title,"
                " vendor=excluded.vendor, product_type=excluded.product_type,"
                " status=excluded.status, price=excluded.price,"
                " currency=excluded.currency, inventory=excluded.inventory,"
                " variants=excluded.variants, payload=excluded.payload,"
                " synced_at=excluded.synced_at",
                (str(product.get("remote_id", "")), shop or "",
                 product.get("title", ""), product.get("vendor", ""),
                 product.get("product_type", ""), product.get("status", ""),
                 float(product.get("price") or 0), product.get("currency", ""),
                 int(product.get("inventory") or 0), int(product.get("variants") or 0),
                 json.dumps(product), now),
            )
            row = c.execute("SELECT * FROM ecommerce_products WHERE remote_id=?",
                            (str(product.get("remote_id", "")),)).fetchone()
            return self._product_row(row)

    def list_products(
        self, shop: str | None = None, status: str | None = None,
        limit: int = 50,
    ) -> list[dict]:
        q = "SELECT * FROM ecommerce_products"
        args: list[Any] = []
        where = []
        if shop:
            where.append("shop=?")
            args.append(shop)
        if status:
            where.append("status=?")
            args.append(status)
        if where:
            q += " WHERE " + " AND ".join(where)
        q += " ORDER BY title LIMIT ?"
        args.append(max(1, limit))
        with self._conn() as c:
            return [self._product_row(r) for r in c.execute(q, args).fetchall()]

    @staticmethod
    def _product_row(row) -> dict:
        d = dict(row)
        return d

    # ---- orders ----
    def upsert_order(self, order: dict, shop: str = "") -> dict:
        now = time.time()
        with self._conn() as c:
            c.execute(
                "INSERT INTO ecommerce_orders(remote_id, shop, order_number, name,"
                " total, currency, financial_status, fulfillment_status,"
                " customer_name, customer_email, line_items, payload, synced_at)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)"
                " ON CONFLICT(remote_id) DO UPDATE SET"
                " shop=excluded.shop, order_number=excluded.order_number,"
                " name=excluded.name, total=excluded.total,"
                " currency=excluded.currency,"
                " financial_status=excluded.financial_status,"
                " fulfillment_status=excluded.fulfillment_status,"
                " customer_name=excluded.customer_name,"
                " customer_email=excluded.customer_email,"
                " line_items=excluded.line_items, payload=excluded.payload,"
                " synced_at=excluded.synced_at",
                (str(order.get("remote_id", "")), shop or "",
                 str(order.get("order_number", "")), order.get("name", ""),
                 float(order.get("total") or 0), order.get("currency", ""),
                 order.get("financial_status", ""), order.get("fulfillment_status", ""),
                 order.get("customer_name", ""), order.get("customer_email", ""),
                 int(order.get("line_items") or 0), json.dumps(order), now),
            )
            row = c.execute("SELECT * FROM ecommerce_orders WHERE remote_id=?",
                            (str(order.get("remote_id", "")),)).fetchone()
            return dict(row)

    def get_order(self, remote_id: str) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM ecommerce_orders WHERE remote_id=?",
                            (str(remote_id),)).fetchone()
            return dict(row) if row else None

    def get_order_by_number(self, order_number: str) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM ecommerce_orders WHERE order_number=?",
                            (str(order_number),)).fetchone()
            return dict(row) if row else None

    def list_orders(
        self, shop: str | None = None, financial_status: str | None = None,
        limit: int = 50,
    ) -> list[dict]:
        q = "SELECT * FROM ecommerce_orders"
        args: list[Any] = []
        where = []
        if shop:
            where.append("shop=?")
            args.append(shop)
        if financial_status:
            where.append("financial_status=?")
            args.append(financial_status)
        if where:
            q += " WHERE " + " AND ".join(where)
        q += " ORDER BY synced_at DESC LIMIT ?"
        args.append(max(1, limit))
        with self._conn() as c:
            return [dict(r) for r in c.execute(q, args).fetchall()]

    def revenue_by_currency(self, shop: str | None = None) -> list[dict]:
        """Net revenue from cached *paid* orders, per currency."""
        q = ("SELECT currency, COUNT(*) AS count, SUM(total) AS total"
             " FROM ecommerce_orders WHERE financial_status='paid'")
        args: list[Any] = []
        if shop:
            q += " AND shop=?"
            args.append(shop)
        q += " GROUP BY currency ORDER BY currency"
        with self._conn() as c:
            rows = c.execute(q, args).fetchall()
            return [{"currency": r["currency"] or "", "count": r["count"],
                     "total": round(r["total"] or 0.0, 2)} for r in rows]

    # ---- customers ----
    def upsert_customer(self, customer: dict, shop: str = "") -> dict:
        now = time.time()
        with self._conn() as c:
            c.execute(
                "INSERT INTO ecommerce_customers(remote_id, shop, first_name,"
                " last_name, email, orders_count, total_spent, currency,"
                " payload, synced_at) VALUES(?,?,?,?,?,?,?,?,?,?)"
                " ON CONFLICT(remote_id) DO UPDATE SET"
                " shop=excluded.shop, first_name=excluded.first_name,"
                " last_name=excluded.last_name, email=excluded.email,"
                " orders_count=excluded.orders_count,"
                " total_spent=excluded.total_spent,"
                " currency=excluded.currency, payload=excluded.payload,"
                " synced_at=excluded.synced_at",
                (str(customer.get("remote_id", "")), shop or "",
                 customer.get("first_name", ""), customer.get("last_name", ""),
                 customer.get("email", ""), int(customer.get("orders_count") or 0),
                 float(customer.get("total_spent") or 0),
                 customer.get("currency", ""), json.dumps(customer), now),
            )
            row = c.execute("SELECT * FROM ecommerce_customers WHERE remote_id=?",
                            (str(customer.get("remote_id", "")),)).fetchone()
            return dict(row)

    def list_customers(self, shop: str | None = None, limit: int = 50) -> list[dict]:
        q = "SELECT * FROM ecommerce_customers"
        args: list[Any] = []
        if shop:
            q += " WHERE shop=?"
            args.append(shop)
        q += " ORDER BY total_spent DESC LIMIT ?"
        args.append(max(1, limit))
        with self._conn() as c:
            return [dict(r) for r in c.execute(q, args).fetchall()]

    # ---- sync state ----
    def set_sync_state(self, shop: str, resource: str, count: int,
                       errors: int = 0, error: str = "") -> None:
        """Record per-resource sync progress.

        Called after *each* resource finishes (not once at the end of a
        whole sync), so a run that dies halfway still leaves progress
        behind: ``last_count`` is how many items of this resource were
        cached, ``last_errors`` / ``last_error`` record what failed.
        A re-run re-fetches and upserts idempotently (upserts key on
        ``remote_id``), so already-cached rows are refreshed, never
        duplicated, and failed items get another chance.
        """
        with self._conn() as c:
            c.execute(
                "INSERT INTO ecommerce_sync_state(shop, resource, last_synced_at,"
                " last_count, last_errors, last_error) VALUES(?,?,?,?,?,?)"
                " ON CONFLICT(shop, resource) DO UPDATE SET"
                " last_synced_at=excluded.last_synced_at,"
                " last_count=excluded.last_count,"
                " last_errors=excluded.last_errors,"
                " last_error=excluded.last_error",
                (shop or "", resource, time.time(), int(count),
                 int(errors), error or ""),
            )

    def get_sync_state(self, shop: str, resource: str) -> dict | None:
        with self._conn() as c:
            row = c.execute(
                "SELECT * FROM ecommerce_sync_state WHERE shop=? AND resource=?",
                (shop or "", resource)).fetchone()
            return dict(row) if row else None

    def get_sync_progress(self, shop: str) -> dict:
        """Per-resource sync progress for a shop: ``{resource: state}``."""
        with self._conn() as c:
            rows = c.execute(
                "SELECT * FROM ecommerce_sync_state WHERE shop=?",
                (shop or "",)).fetchall()
            return {r["resource"]: dict(r) for r in rows}

    def counts(self) -> dict:
        with self._conn() as c:
            return {
                "products": c.execute(
                    "SELECT COUNT(*) FROM ecommerce_products").fetchone()[0],
                "orders": c.execute(
                    "SELECT COUNT(*) FROM ecommerce_orders").fetchone()[0],
                "customers": c.execute(
                    "SELECT COUNT(*) FROM ecommerce_customers").fetchone()[0],
            }
