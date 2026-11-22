#!/bin/bash
# Se ejecuta SOLO en la primera inicialización del volumen de MySQL (montado
# en /docker-entrypoint-initdb.d por docker-compose.yml). MYSQL_ROOT_PASSWORD
# ya existe como variable de entorno en este punto — se reutiliza tal cual
# para el usuario de la app, en vez de meter la contraseña por segunda vez
# en un fichero aparte.
#
# IDENTIFIED WITH mysql_native_password (no el caching_sha2_password por
# defecto de MySQL 8): backupService.js llama a mysqldump, y el cliente que
# trae esta imagen es en realidad mariadb-dump (Alpine no empaqueta el de
# Oracle) — a ese binario le falta el .so del plugin caching_sha2_password,
# así que con el plugin por defecto todo mysqldump fallaría en conectar.
# mysql_native_password lo soportan ambos lados sin plugins extra; requiere
# --mysql-native-password=ON en el `command:` de rpbot-bd (docker-compose.yml),
# porque MySQL 8.4 lo trae deshabilitado por defecto.
mysql --user=root --password="${MYSQL_ROOT_PASSWORD}" <<-EOSQL
    CREATE USER IF NOT EXISTS 'propst'@'%' IDENTIFIED WITH mysql_native_password BY '${MYSQL_ROOT_PASSWORD}';
    GRANT ALL PRIVILEGES ON *.* TO 'propst'@'%' WITH GRANT OPTION;
    FLUSH PRIVILEGES;
EOSQL
