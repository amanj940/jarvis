"""Instant Full-System Reconnaissance & Smart Spider for JARVIS.

Gathers full-system awareness across running services, open network ports,
storage partitions, and developer project workspaces in seconds without
slowing down the CPU or disk.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

import psutil

log = logging.getLogger("jarvis.system_spider")

# Directories to always skip during fast workspace discovery
IGNORED_DIRS = {
    ".cache", ".git", ".venv", "venv", "node_modules", "__pycache__",
    ".local", ".var", ".cargo", ".rustup", ".npm", ".mozilla", ".config",
    "dist", "build", "Trash", ".thunderbird", ".steam", ".wine"
}


def get_running_services(limit: int = 40) -> list[dict[str, str]]:
    """Discover active systemd user and system services."""
    services: list[dict[str, str]] = []
    
    # 1. User services
    try:
        out = subprocess.check_output(
            ["systemctl", "--user", "list-units", "--type=service", "--state=running", "--no-legend", "--no-pager"],
            text=True, stderr=subprocess.DEVNULL, timeout=2.0
        )
        for line in out.splitlines():
            parts = line.split(None, 4)
            if parts:
                name = parts[0]
                desc = parts[4] if len(parts) >= 5 else ""
                services.append({"name": name, "scope": "user", "description": desc})
    except Exception:
        pass

    # 2. System services (sample top ones)
    try:
        out = subprocess.check_output(
            ["systemctl", "list-units", "--type=service", "--state=running", "--no-legend", "--no-pager"],
            text=True, stderr=subprocess.DEVNULL, timeout=2.0
        )
        for line in out.splitlines():
            parts = line.split(None, 4)
            if parts:
                name = parts[0]
                desc = parts[4] if len(parts) >= 5 else ""
                services.append({"name": name, "scope": "system", "description": desc})
    except Exception:
        pass

    return services[:limit]


def get_listening_ports() -> list[dict[str, Any]]:
    """Discover active network listeners, local servers, and databases."""
    ports: list[dict[str, Any]] = []
    try:
        conns = psutil.net_connections(kind="inet")
        seen: set[tuple[str, int]] = set()
        for c in conns:
            if c.status == "LISTEN" and c.laddr:
                ip, port = c.laddr.ip, c.laddr.port
                if (ip, port) in seen:
                    continue
                seen.add((ip, port))
                proc_name = "unknown"
                if c.pid:
                    try:
                        proc_name = psutil.Process(c.pid).name()
                    except Exception:
                        pass
                ports.append({
                    "port": port,
                    "address": f"{ip}:{port}",
                    "pid": c.pid,
                    "process": proc_name,
                })
        ports.sort(key=lambda x: x["port"])
    except Exception:
        # Fallback to ss if psutil permissions restrict
        try:
            out = subprocess.check_output(["ss", "-tulpn"], text=True, stderr=subprocess.DEVNULL, timeout=2.0)
            for line in out.splitlines()[1:]:
                parts = line.split()
                if len(parts) >= 5:
                    ports.append({"raw": line[:100]})
        except Exception:
            pass
    return ports[:35]


def get_storage_mounts() -> list[dict[str, Any]]:
    """Discover physical and mounted storage devices."""
    mounts = []
    try:
        for p in psutil.disk_partitions(all=False):
            if p.device.startswith("/dev/"):
                try:
                    usage = psutil.disk_usage(p.mountpoint)
                    mounts.append({
                        "device": p.device,
                        "mountpoint": p.mountpoint,
                        "fstype": p.fstype,
                        "total_gb": round(usage.total / (1024**3), 1),
                        "used_gb": round(usage.used / (1024**3), 1),
                        "free_gb": round(usage.free / (1024**3), 1),
                        "percent": usage.percent,
                    })
                except Exception:
                    pass
    except Exception:
        pass
    return mounts


def scan_workspaces(base_path: str = "~", max_depth: int = 3) -> list[dict[str, Any]]:
    """Fast intelligent workspace finder that identifies project repositories."""
    root = Path(os.path.expanduser(base_path)).resolve()
    if not root.exists():
        return []

    projects: list[dict[str, Any]] = []

    def _walk(current: Path, depth: int):
        if depth > max_depth:
            return

        try:
            entries = list(os.scandir(current))
        except (PermissionError, OSError):
            return

        dir_names = set()
        file_names = set()
        for e in entries:
            try:
                if e.is_dir(follow_symlinks=False):
                    dir_names.add(e.name)
                elif e.is_file(follow_symlinks=False):
                    file_names.add(e.name)
            except OSError:
                continue

        # Check if current directory is a project root
        is_project = False
        project_type = "generic"
        details: dict[str, Any] = {}

        if ".git" in dir_names:
            is_project = True
            details["vcs"] = "git"

        if "package.json" in file_names:
            is_project = True
            project_type = "Node/Web"
            try:
                pkg_data = json.loads((current / "package.json").read_text(encoding="utf-8", errors="ignore"))
                details["name"] = pkg_data.get("name")
                details["description"] = pkg_data.get("description")
            except Exception:
                pass

        if any(f in file_names for f in ("pyproject.toml", "requirements.txt", "setup.py")):
            is_project = True
            project_type = "Python"

        if "Cargo.toml" in file_names:
            is_project = True
            project_type = "Rust"

        if "go.mod" in file_names:
            is_project = True
            project_type = "Go"

        if any(f in file_names for f in ("pom.xml", "build.gradle")):
            is_project = True
            project_type = "Java/JVM"

        if any(f in file_names for f in ("CMakeLists.txt", "Makefile")):
            if not is_project:
                is_project = True
                project_type = "C/C++"

        if any(f in file_names for f in ("docker-compose.yml", "Dockerfile")):
            details["docker"] = True

        if is_project and current != root:
            # Check for README
            readme_sample = ""
            for rname in ("README.md", "README", "readme.md"):
                if rname in file_names:
                    try:
                        readme_sample = (current / rname).read_text(encoding="utf-8", errors="ignore")[:300].strip()
                        break
                    except Exception:
                        pass

            proj_info = {
                "name": details.get("name") or current.name,
                "path": str(current),
                "type": project_type,
                "summary": details.get("description") or readme_sample or f"{project_type} project at {current.name}",
                "vcs": details.get("vcs", "none"),
                "has_docker": details.get("docker", False),
            }
            projects.append(proj_info)
            # Do not recurse deeply into subprojects unless it is a monorepo root
            if depth >= 2:
                return

        # Recurse into child directories that are not ignored
        for dname in dir_names:
            if dname in IGNORED_DIRS or dname.startswith("."):
                continue
            _walk(current / dname, depth + 1)

    _walk(root, 1)
    return projects


def run_full_system_recon(memory: Any = None) -> dict[str, Any]:
    """Execute instant full-system reconnaissance and persist snapshot into database."""
    start_t = time.time()
    
    # 1. Services
    services = get_running_services()
    
    # 2. Network ports
    ports = get_listening_ports()
    
    # 3. Storage
    mounts = get_storage_mounts()
    
    # 4. Workspaces & Projects
    projects = scan_workspaces(base_path="~", max_depth=3)
    
    elapsed = round(time.time() - start_t, 2)
    
    snapshot = {
        "timestamp": time.time(),
        "elapsed_seconds": elapsed,
        "services_count": len(services),
        "active_services": services[:25],
        "listening_ports": ports,
        "storage_mounts": mounts,
        "projects_count": len(projects),
        "projects": projects,
    }
    
    # Persist into database if memory is provided or accessible
    if memory is None:
        try:
            from ..config import load_config
            from .memory import Memory
            cfg = load_config()
            memory = Memory(cfg)
        except Exception as e:
            log.warning("Could not instantiate Memory for persistence: %s", e)

    if memory is not None and hasattr(memory, "store_entity"):
        try:
            # 1. Store the master deep recon audit
            memory.store_entity(
                collection="system_audit",
                key="deep_recon",
                data={
                    "scan_time": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "elapsed_seconds": elapsed,
                    "services_running": len(services),
                    "open_ports": [p.get("port") for p in ports if "port" in p],
                    "storage_partitions": len(mounts),
                    "detected_projects": [p["name"] for p in projects],
                },
                tags=["system", "audit", "recon"]
            )
            # 2. Store individual projects
            for p in projects:
                clean_key = p["name"].replace("/", "_").replace(" ", "_").lower()
                memory.store_entity(
                    collection="projects",
                    key=clean_key,
                    data=p,
                    tags=["project", p["type"].lower()]
                )
            log.info("Full system recon completed in %ss and stored in database.", elapsed)
        except Exception as e:
            log.error("Failed to store system recon in database: %s", e)

    return snapshot
