"""Local host and system environment profiler for JARVIS.

Discovers and caches hardware specs, OS distro, desktop environment,
user identity, installed desktop applications, and provides real-time
temporal context for LLM prompt injection.
"""
from __future__ import annotations

import datetime
import os
import platform
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import psutil


@dataclass
class HostProfile:
    os_name: str = "Linux"
    distro_name: str = ""
    distro_version: str = ""
    kernel_version: str = ""
    arch: str = ""
    hostname: str = ""
    username: str = ""
    home_dir: str = ""
    shell: str = ""
    desktop_env: str = ""
    display_server: str = ""
    cpu_model: str = ""
    cpu_cores: int = 1
    ram_total_gb: float = 0.0
    disk_total_gb: float = 0.0
    disk_free_gb: float = 0.0
    package_manager: str = ""
    gpu_info: str = "None / Integrated"
    installed_tools: list[str] = field(default_factory=list)


_CACHED_PROFILE: HostProfile | None = None


def get_distro_info() -> tuple[str, str]:
    """Parse /etc/os-release to detect distro name and version."""
    distro_name = platform.system()
    distro_version = platform.release()
    try:
        os_release = Path("/etc/os-release")
        if os_release.exists():
            data: dict[str, str] = {}
            for line in os_release.read_text(encoding="utf-8", errors="replace").splitlines():
                if "=" in line:
                    k, v = line.split("=", 1)
                    data[k.strip()] = v.strip().strip('"').strip("'")
            distro_name = data.get("PRETTY_NAME") or data.get("NAME") or distro_name
            distro_version = data.get("VERSION_ID") or data.get("VERSION") or distro_version
    except Exception:
        pass
    return distro_name, distro_version


def get_cpu_model() -> str:
    """Read CPU model name from /proc/cpuinfo or platform."""
    try:
        cpuinfo = Path("/proc/cpuinfo")
        if cpuinfo.exists():
            for line in cpuinfo.read_text(encoding="utf-8", errors="replace").splitlines():
                if "model name" in line:
                    return line.split(":", 1)[1].strip()
    except Exception:
        pass
    return platform.processor() or "Unknown CPU"


def get_gpu_info() -> str:
    """Check for NVIDIA or Intel/AMD GPU info."""
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=2.0,
        ).strip()
        if out:
            return out
    except Exception:
        pass
    # Fallback to lspci if available
    try:
        lspci = shutil.which("lspci")
        if lspci:
            out = subprocess.check_output(
                [lspci],
                stderr=subprocess.DEVNULL,
                text=True,
                timeout=2.0,
            )
            for line in out.splitlines():
                if "VGA" in line or "3D" in line:
                    return line.split(":", 2)[-1].strip()
    except Exception:
        pass
    return "Integrated Graphics / Standard VGA"


def detect_package_manager() -> str:
    """Detect default Linux package manager."""
    for pm in ("dnf", "rpm", "apt", "pacman", "zypper", "apk"):
        if shutil.which(pm):
            return pm
    return "unknown"


def get_host_profile(force_refresh: bool = False) -> HostProfile:
    """Retrieve or build the host profile singleton."""
    global _CACHED_PROFILE
    if _CACHED_PROFILE is not None and not force_refresh:
        return _CACHED_PROFILE

    distro_name, distro_version = get_distro_info()
    uname = platform.uname()

    home = os.environ.get("HOME", str(Path.home()))
    user = os.environ.get("USER") or os.environ.get("LOGNAME") or Path(home).name

    desktop = os.environ.get("XDG_CURRENT_DESKTOP") or os.environ.get("DESKTOP_SESSION") or "Desktop"
    display = os.environ.get("XDG_SESSION_TYPE") or ("Wayland" if "WAYLAND_DISPLAY" in os.environ else "X11")

    # Hardware stats
    cpu_cores = psutil.cpu_count(logical=True) or 1
    mem = psutil.virtual_memory()
    ram_gb = round(mem.total / (1024**3), 2)

    try:
        disk = psutil.disk_usage(home)
        disk_total = round(disk.total / (1024**3), 1)
        disk_free = round(disk.free / (1024**3), 1)
    except Exception:
        disk_total, disk_free = 0.0, 0.0

    # Common command-line tools
    tools_to_check = ["bash", "zsh", "python3", "node", "npm", "git", "curl", "wget", "docker", "gcc"]
    installed = [t for t in tools_to_check if shutil.which(t)]

    profile = HostProfile(
        os_name=uname.system,
        distro_name=distro_name,
        distro_version=distro_version,
        kernel_version=uname.release,
        arch=uname.machine,
        hostname=uname.node,
        username=user,
        home_dir=home,
        shell=os.environ.get("SHELL", "/bin/bash"),
        desktop_env=desktop,
        display_server=display,
        cpu_model=get_cpu_model(),
        cpu_cores=cpu_cores,
        ram_total_gb=ram_gb,
        disk_total_gb=disk_total,
        disk_free_gb=disk_free,
        package_manager=detect_package_manager(),
        gpu_info=get_gpu_info(),
        installed_tools=installed,
    )
    _CACHED_PROFILE = profile
    return profile


def get_host_context_block() -> str:
    """Generate a rich, live host context prompt block for LLM system prompt injection."""
    p = get_host_profile()
    now = datetime.datetime.now()
    now_str = now.strftime("%A, %Y-%m-%d %H:%M:%S")
    tz_name = datetime.datetime.now().astimezone().tzname() or "Local"

    # Live dynamic memory usage
    try:
        mem = psutil.virtual_memory()
        ram_status = f"{mem.percent}% used ({round(mem.used / (1024**3), 1)}/{p.ram_total_gb} GB)"
    except Exception:
        ram_status = f"{p.ram_total_gb} GB"

    return (
        "=== LOCAL SYSTEM & HOST ENVIRONMENT ===\n"
        f"• Local Time: {now_str} ({tz_name})\n"
        f"• Host User: {p.username} (Home: {p.home_dir}) | Hostname: {p.hostname}\n"
        f"• Operating System: {p.distro_name} (Kernel {p.kernel_version}, {p.arch})\n"
        f"• Desktop Environment: {p.desktop_env} on {p.display_server} | Shell: {p.shell}\n"
        f"• Hardware: {p.cpu_model} ({p.cpu_cores} cores) | RAM: {ram_status}\n"
        f"• GPU: {p.gpu_info}\n"
        f"• Storage: {p.disk_free_gb} GB free of {p.disk_total_gb} GB\n"
        f"• Package Manager: {p.package_manager}\n"
        f"• Available CLI Tools: {', '.join(p.installed_tools)}\n"
        "Guidelines:\n"
        "- You are running directly inside this local machine with full tool authorization.\n"
        "- Tailor Linux commands to this specific distribution (Fedora) and shell (Bash).\n"
        "- Do not guess time or date; rely on the real-time clock above.\n"
        "========================================"
    )


def list_desktop_apps() -> list[dict[str, str]]:
    """Scan and list installed desktop GUI applications from standard Linux paths."""
    search_dirs = [
        Path("/usr/share/applications"),
        Path("/usr/local/share/applications"),
        Path.home() / ".local/share/applications",
    ]

    apps: list[dict[str, str]] = []
    seen: set[str] = set()

    for d in search_dirs:
        if not d.exists():
            continue
        for desktop_file in d.glob("*.desktop"):
            try:
                content = desktop_file.read_text(encoding="utf-8", errors="replace")
                name = ""
                exec_cmd = ""
                comment = ""
                nodisplay = False
                terminal = False

                for line in content.splitlines():
                    line = line.strip()
                    if line.startswith("Name=") and not name:
                        name = line.split("=", 1)[1].strip()
                    elif line.startswith("Exec=") and not exec_cmd:
                        exec_cmd = line.split("=", 1)[1].strip()
                    elif line.startswith("Comment=") and not comment:
                        comment = line.split("=", 1)[1].strip()
                    elif line == "NoDisplay=true":
                        nodisplay = True
                    elif line == "Terminal=true":
                        terminal = True

                if name and exec_cmd and not nodisplay:
                    # Clean %u, %f, etc. from exec
                    clean_exec = " ".join(part for part in exec_cmd.split() if not part.startswith("%"))
                    base_key = name.lower()
                    if base_key not in seen:
                        seen.add(base_key)
                        apps.append({
                            "name": name,
                            "command": clean_exec,
                            "description": comment,
                            "terminal": "true" if terminal else "false",
                            "file": desktop_file.name,
                        })
            except Exception:
                continue

    apps.sort(key=lambda x: x["name"].lower())
    return apps
