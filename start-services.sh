#!/bin/bash
# Vaani Startup Script: Starts MySQL Database and Spring Boot Backend

export LD_LIBRARY_PATH=/home/vedant/.tools/lib:$LD_LIBRARY_PATH
export JAVA_HOME=/home/vedant/.tools/jdk-21.0.6+7

echo "============================================="
echo " Starting MySQL Database (MariaDB 10.11)..."
echo "============================================="
/home/vedant/.tools/mariadb-10.11.6-linux-systemd-x86_64/bin/mariadbd \
  --basedir=/home/vedant/.tools/mariadb-10.11.6-linux-systemd-x86_64 \
  --plugin-dir=/home/vedant/.tools/mariadb-10.11.6-linux-systemd-x86_64/lib/plugin \
  --datadir=/home/vedant/.tools/mariadb-data \
  --port=3306 \
  --socket=/home/vedant/.tools/mariadb.sock > /dev/null 2>&1 &

sleep 2

echo "============================================="
echo " Starting Java Spring Boot Server..."
echo " Server URL: http://localhost:8080"
echo "============================================="
$JAVA_HOME/bin/java -jar /home/vedant/vaani/backend/target/vaani-backend-1.0.0.jar
