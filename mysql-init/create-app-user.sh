#!/bin/bash
mysql --user=root --password="${MYSQL_ROOT_PASSWORD}" <<-EOSQL
    CREATE USER IF NOT EXISTS 'propst'@'%' IDENTIFIED WITH mysql_native_password BY '${MYSQL_ROOT_PASSWORD}';
    GRANT ALL PRIVILEGES ON *.* TO 'propst'@'%' WITH GRANT OPTION;
    FLUSH PRIVILEGES;
EOSQL
