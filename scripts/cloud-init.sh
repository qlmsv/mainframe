#!/bin/sh
curl -fsSL https://raw.githubusercontent.com/qlmsv/mainframe/main/scripts/install-server.sh | bash -s КЛЮЧ_БОТА > /var/log/mainframe-install.log 2>&1
