# systemd Setup Guide for Stigmer

This guide explains how to set up systemd to monitor and auto-restart stigmer-server in production.

---

## Understanding the Supervision Hierarchy

### Without systemd (Development):
```
USER (manual restart)
    ↓
stigmer-server
    ↓
    ├── workflow-runner (auto-restarts)
    └── agent-runner (auto-restarts)
```

**If stigmer-server crashes:** You must manually run `stigmer server start`

### With systemd (Production):
```
systemd (auto-restarts)
    ↓
stigmer-server
    ↓
    ├── workflow-runner (auto-restarts)
    └── agent-runner (auto-restarts)
```

**If stigmer-server crashes:** systemd restarts it automatically within 10 seconds

---

## Prerequisites

1. **Linux system with systemd** (Ubuntu 20.04+, RHEL 8+, etc.)
2. **stigmer binary installed** at `/usr/local/bin/stigmer`
3. **Root access** (for systemd configuration)

---

## Installation Steps

### 1. Create stigmer user and directories

```bash
# Create dedicated user for stigmer service
sudo useradd -r -s /bin/false -d /var/lib/stigmer stigmer

# Create directories
sudo mkdir -p /var/lib/stigmer
sudo mkdir -p /var/log/stigmer

# Set ownership
sudo chown -R stigmer:stigmer /var/lib/stigmer
sudo chown -R stigmer:stigmer /var/log/stigmer

# Set permissions
sudo chmod 750 /var/lib/stigmer
sudo chmod 755 /var/log/stigmer
```

### 2. Install stigmer binary

```bash
# Copy stigmer binary to system path
sudo cp stigmer /usr/local/bin/stigmer
sudo chmod +x /usr/local/bin/stigmer

# Verify installation
stigmer version
```

### 3. Install systemd service file

```bash
# Copy service file
sudo cp stigmer.service /etc/systemd/system/

# Reload systemd to recognize new service
sudo systemctl daemon-reload
```

### 4. Configure environment (optional)

If you need custom configuration, edit the service file:

```bash
sudo nano /etc/systemd/system/stigmer.service
```

Add environment variables as needed:
```ini
Environment="STIGMER_LLM_PROVIDER=openai"
Environment="OPENAI_API_KEY=sk-..."
```

### 5. Enable and start the service

```bash
# Enable service to start on boot
sudo systemctl enable stigmer

# Start the service
sudo systemctl start stigmer

# Check status
sudo systemctl status stigmer
```

---

## Management Commands

### Check Status
```bash
sudo systemctl status stigmer
```

Output example:
```
● stigmer.service - Stigmer Server - AI Agent Workflow Platform
     Loaded: loaded (/etc/systemd/system/stigmer.service; enabled)
     Active: active (running) since Sun 2026-01-25 14:30:00 UTC; 2h ago
   Main PID: 12345 (stigmer)
      Tasks: 15 (limit: 4096)
     Memory: 512M
     CGroup: /system.slice/stigmer.service
             ├─12345 /usr/local/bin/stigmer internal-server
             ├─12346 /usr/local/bin/stigmer internal-workflow-runner
             └─12347 docker run ... stigmer-agent-runner
```

### View Logs
```bash
# Real-time logs
sudo journalctl -u stigmer -f

# Last 100 lines
sudo journalctl -u stigmer -n 100

# Since today
sudo journalctl -u stigmer --since today
```

### Restart Service
```bash
sudo systemctl restart stigmer
```

### Stop Service
```bash
sudo systemctl stop stigmer
```

### Disable Auto-start
```bash
sudo systemctl disable stigmer
```

---

## How systemd Auto-Restart Works

### The Magic Configuration

In `stigmer.service`, these lines enable auto-restart:

```ini
[Service]
Restart=always          # Always restart on exit
RestartSec=10           # Wait 10 seconds before restart
```

### Restart Triggers

systemd will restart stigmer-server if:
- ✅ Process crashes (SIGSEGV, panic, etc.)
- ✅ Process killed manually (`kill -9`)
- ✅ Process exits with non-zero status
- ✅ Out of memory (OOM killer)
- ✅ Any unexpected termination

systemd will NOT restart if:
- ❌ Normal exit (exit code 0)
- ❌ Manual stop (`systemctl stop stigmer`)
- ❌ System shutdown/reboot

### Testing Auto-Restart

```bash
# Find stigmer-server PID
sudo systemctl status stigmer | grep "Main PID"

# Kill the process
sudo kill -9 <PID>

# Wait 10 seconds
sleep 10

# Check status - should show restarted
sudo systemctl status stigmer
```

You should see:
```
Active: active (running) since Sun 2026-01-25 14:35:10 UTC; 5s ago
  # Notice new start time and PID
```

---

## Monitoring and Alerting

### Check if stigmer is running

```bash
systemctl is-active stigmer
```

Returns: `active` or `inactive`

### Count restarts

```bash
sudo journalctl -u stigmer | grep -c "Started Stigmer Server"
```

### Set up alerts (optional)

Create a systemd override for email alerts:

```bash
sudo systemctl edit stigmer
```

Add:
```ini
[Service]
OnFailure=status-email@%n.service
```

This requires `systemd-email` package:
```bash
sudo apt install systemd-email
```

---

## Uninstallation

```bash
# Stop and disable service
sudo systemctl stop stigmer
sudo systemctl disable stigmer

# Remove service file
sudo rm /etc/systemd/system/stigmer.service
sudo systemctl daemon-reload

# Remove binary
sudo rm /usr/local/bin/stigmer

# Remove data (CAREFUL - this deletes everything)
sudo rm -rf /var/lib/stigmer
sudo rm -rf /var/log/stigmer

# Remove user
sudo userdel stigmer
```

---

## Troubleshooting

### Service fails to start

```bash
# Check logs
sudo journalctl -u stigmer -xe

# Common issues:
# - Binary not found: Check /usr/local/bin/stigmer exists
# - Permission denied: Check file permissions
# - Port already in use: Check if another stigmer is running
```

### Service keeps restarting

```bash
# Check restart count
sudo journalctl -u stigmer | grep "Started Stigmer"

# View crash logs
sudo journalctl -u stigmer --since "10 minutes ago"

# If stuck in crash loop, stop it manually:
sudo systemctl stop stigmer
```

### Can't connect to stigmer

```bash
# Check if service is running
sudo systemctl status stigmer

# Check port binding
sudo netstat -tlnp | grep 7234

# Check firewall
sudo ufw status
```

---

## Comparison: Manual vs systemd

| Scenario | Without systemd | With systemd |
|----------|----------------|--------------|
| stigmer-server crashes | ❌ Stays down, manual restart required | ✅ Auto-restarts in 10s |
| workflow-runner crashes | ✅ Auto-restarts (by stigmer-server) | ✅ Auto-restarts (by stigmer-server) |
| Server reboot | ❌ Must manually start | ✅ Starts automatically |
| Monitoring | ❌ Manual checks | ✅ `systemctl status` |
| Logs | ❌ Multiple files | ✅ Centralized journalctl |
| Production-ready | ❌ No | ✅ Yes |

---

## Next Steps for Production

1. ✅ Install systemd service (this guide)
2. ⏭️ Set up reverse proxy (nginx/tracer)
3. ⏭️ Configure TLS/SSL certificates
4. ⏭️ Set up monitoring (Prometheus/Grafana)
5. ⏭️ Configure backups for `/var/lib/stigmer`
6. ⏭️ Set up log rotation for `/var/log/stigmer`

---

## Key Takeaway

**systemd monitoring is NOT automatic.** You must:
1. Create a systemd service file
2. Install it to `/etc/systemd/system/`
3. Enable and start the service

Only then will systemd monitor and auto-restart stigmer-server.

**For development:** Manual restart is fine. You're actively watching the system.

**For production:** systemd is essential for reliability and uptime.
