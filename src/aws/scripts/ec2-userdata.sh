#!/bin/bash
set -ex
exec > /var/log/aura-setup.log 2>&1
dnf install -y git nginx nodejs20 python3.11 python3.11-pip
alternatives --install /usr/bin/node node /usr/bin/node-20 1 || true
alternatives --install /usr/bin/npm npm /usr/bin/npm-20 1 || true
git clone --depth 1 https://github.com/agranianupam/AURA_Cloud_Project_2026.git /opt/aura
cd /opt/aura
python3.11 -m venv .venv
.venv/bin/pip install --no-cache-dir -r src/ml_model/requirements.txt
cd src/backend && npm ci --omit=dev
chown -R ec2-user:ec2-user /opt/aura
mkdir -p /usr/share/nginx/aura && chown ec2-user /usr/share/nginx/aura

cat > /etc/systemd/system/aura.service <<'EOF'
[Unit]
Description=AURA API
After=network.target
[Service]
User=ec2-user
WorkingDirectory=/opt/aura/src/backend
Environment=AUTH_DISABLED=true PORT=3000 PYTHON=/opt/aura/.venv/bin/python
ExecStart=/usr/bin/node src/server.js
Restart=always
[Install]
WantedBy=multi-user.target
EOF

cat > /etc/nginx/conf.d/aura.conf <<'EOF'
server {
  listen 80 default_server;
  client_max_body_size 6m;
  root /usr/share/nginx/aura;
  location /api/ { proxy_pass http://127.0.0.1:3000; proxy_read_timeout 300s; }
  location / { try_files $uri /index.html; }
}
EOF
sed -i 's/listen       80;/listen 8080;/; s/listen       \[::\]:80;/listen [::]:8080;/' /etc/nginx/nginx.conf

systemctl daemon-reload
systemctl enable --now aura nginx
touch /var/log/aura-setup-done
