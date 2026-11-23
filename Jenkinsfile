def attemptRollback() {
  def status = sh(returnStatus: true, script: '''
    set -u
    rolled=""; missing=""
    for pair in "${IMAGE_NAME}:bot/api" "${WEB_IMAGE_NAME}:web"; do
      image="${pair%%:*}"; label="${pair#*:}"
      if docker image inspect "${image}:rollback" > /dev/null 2>&1; then
        docker tag "${image}:rollback" "${image}:latest"
        rolled="${rolled}${rolled:+, }${label}"
      else
        missing="${missing}${missing:+, }${label}"
      fi
    done

    if [ -n "$rolled" ]; then
      docker compose up -d --no-build --remove-orphans
      echo "Rolled back to the previous working image for: ${rolled}."
    fi
    if [ -n "$missing" ]; then
      echo "No :rollback tag available for: ${missing} — looks like the first deploy on this host for it. Puede seguir caído, hace falta intervención manual."
    fi
    echo "AVISO: si la migración 039 ya se aplicó, la imagen anterior no sirve con la base actual: restaura el volcado de /media/raid/database/maris/pre-deploy o el último backup."
  ''')
  if (status != 0) {
    echo 'El propio rollback ha fallado — hace falta intervención manual en el host.'
  }
}

pipeline {
  agent any

  parameters {
    booleanParam(
      name: 'PULL_BASE_IMAGES',
      defaultValue: false,
      description: 'Refrescar las imágenes base (node:22-alpine) desde el registro. Más lento (~80s si la base ha cambiado); úsalo periódicamente para recoger parches de seguridad.'
    )
    booleanParam(
      name: 'NO_CACHE',
      defaultValue: false,
      description: 'Reconstruir desde cero, ignorando la caché de capas. Solo para depurar: multiplica por ~20 el tiempo de despliegue.'
    )
  }

  options {
    timeout(time: 20, unit: 'MINUTES')
    disableConcurrentBuilds()
    timestamps()
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  environment {
    IMAGE_NAME = 'maris-bot'
    WEB_IMAGE_NAME = 'maris-web'
    COMPOSE_PROJECT_NAME = 'maris'
  }

  stages {

    stage('Checkout') {
      steps {
        sh 'git config --global --add safe.directory "${WORKSPACE}"'
        checkout scm
        script {
          env.GIT_SHA = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
          env.HOST_PROJECT_DIR = env.WORKSPACE.replaceFirst('^/var/jenkins_home', '/home/docker/jenkins/jenkins_home')
        }
        echo "Building commit: ${env.GIT_SHA}"
        echo "Host-side project dir (para los bind mounts relativos): ${env.HOST_PROJECT_DIR}"
      }
    }

    stage('Preflight') {
      steps {
        sh '''
          docker info > /dev/null || (echo "Docker daemon unreachable from this agent." && exit 1)
          test -f .env || (echo ".env is missing in the workspace — docker-compose.yml requires it (env_file: .env)." && exit 1)
          test -f config.json || (echo "config.json is missing in the workspace — bot y api lo montan como volumen (roles/canales de Staff)." && exit 1)
          test -f nginx/nginx.conf || (echo "nginx/nginx.conf is missing in the workspace." && exit 1)
          docker compose config -q

          docker run --rm \
            -v "${HOST_PROJECT_DIR}/nginx/nginx.conf:/probe/nginx.conf:ro" \
            -v "${HOST_PROJECT_DIR}/config.json:/probe/config.json:ro" \
            alpine:3.19 sh -c 'test -f /probe/nginx.conf && test -f /probe/config.json' \
            || (echo "El demonio de Docker no ve estos ficheros en HOST_PROJECT_DIR (${HOST_PROJECT_DIR}) — revisa que esa sea de verdad la ruta del workspace vista desde el host (ver el cálculo de HOST_PROJECT_DIR en el stage Checkout del Jenkinsfile)." && exit 1)

          docker run --rm \
            -v /media/raid/database/maris:/probe/db \
            -v /media/raid/bucket/maris/avatars:/probe/avatars \
            alpine:3.19 true \
            || (echo "No se han podido preparar los directorios de datos persistentes en el host (/media/raid/...) — revisa que el disco esté montado y que el demonio de Docker pueda escribir ahí." && exit 1)
        '''
      }
    }

    stage('Snapshot previous image') {
      steps {
        sh '''
          set -u
          for image in "${IMAGE_NAME}" "${WEB_IMAGE_NAME}"; do
            if docker image inspect "${image}:latest" > /dev/null 2>&1; then
              docker tag "${image}:latest" "${image}:rollback"
              echo "Snapshotted current ${image}:latest as :rollback before building."
            else
              echo "No existing ${image}:latest image found — nothing to snapshot (first deploy on this host?)."
            fi
          done
        '''
      }
    }

    stage('Build') {
      steps {
        retry(2) {
          timeout(time: 12, unit: 'MINUTES') {
            sh '''
              set -u
              args=""
              if [ "${NO_CACHE:-false}" = "true" ]; then
                args="${args} --no-cache"
                echo "⚠️  NO_CACHE activado: reconstrucción completa, esto va a tardar."
              fi
              if [ "${PULL_BASE_IMAGES:-false}" = "true" ]; then
                args="${args} --pull"
                echo "Refrescando imágenes base desde el registro."
              fi
              docker compose build ${args} maris-rp-disc-bot maris-rp-web
            '''
          }
        }
      }
    }

    stage('Test') {
      steps {
        sh '''
          set -u

          TEST_NET="maris-test-net-${BUILD_NUMBER:-manual}"
          TEST_DB="maris-test-db-${BUILD_NUMBER:-manual}"
          TEST_DB_PASSWORD="test-only-throwaway"

          cleanup() {
            docker rm -fv "${TEST_DB}" > /dev/null 2>&1 || true
            docker network rm "${TEST_NET}" > /dev/null 2>&1 || true
          }
          trap cleanup EXIT

          cleanup
          docker network create "${TEST_NET}" > /dev/null
          docker run -d --name "${TEST_DB}" --network "${TEST_NET}" \
            -e MYSQL_ROOT_PASSWORD="${TEST_DB_PASSWORD}" \
            mysql:8 > /dev/null

          set +x
          deadline=$(( $(date +%s) + 90 ))
          until docker exec "${TEST_DB}" mysqladmin ping \
                  --protocol=tcp -h 127.0.0.1 \
                  -p"${TEST_DB_PASSWORD}" --silent > /dev/null 2>&1; do
            if [ "$(date +%s)" -ge "$deadline" ]; then
              echo "La MySQL de test no ha arrancado en 90s. Logs:"
              docker logs --tail=50 "${TEST_DB}" || true
              exit 1
            fi
            sleep 2
          done
          set -x

          docker run --rm --network "${TEST_NET}" \
            -v "${HOST_PROJECT_DIR}/config.json:/app/config.json:ro" \
            -e DB_HOST="${TEST_DB}" \
            -e DB_PORT=3306 \
            -e DB_USER=root \
            -e DB_PASSWORD="${TEST_DB_PASSWORD}" \
            -e INTEGRATION_ALLOW_ANY_PORT=1 \
            "${IMAGE_NAME}:latest" sh -c 'npm test && npm run test:integration'
        '''
      }
    }

    stage('Pre-deploy checks and backup') {
      steps {
        sh '''
          set -u

          for var in API_PUBLIC_URL API_SESSION_SECRET PANEL_HOST BUCKET_HOST; do
            grep -Eq "^${var}=.+" .env || (echo "Falta ${var} en el .env del servidor: la API no arrancaría." && exit 1)
          done

          if docker ps -q -f "name=^/maris-rp-mysql$" | grep -q .; then
            stamp="$(date -u +%Y%m%dT%H%M%SZ)-${GIT_SHA}"
            docker exec maris-rp-mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --databases rp_players rp_world rp_economy rp_ops' \
              | docker run --rm -i -v /media/raid/database/maris/pre-deploy:/out alpine:3.19 sh -c "
                  gzip > /out/pre-deploy-${stamp}.sql.gz
                  test \\$(wc -c < /out/pre-deploy-${stamp}.sql.gz) -gt 1024
                  ls -1t /out/pre-deploy-*.sql.gz | tail -n +6 | xargs -r rm -f
                " \
              || (echo "No se pudo hacer el volcado de seguridad previo al despliegue: se aborta antes de tocar nada." && exit 1)
            echo "Volcado de seguridad guardado en /media/raid/database/maris/pre-deploy/pre-deploy-${stamp}.sql.gz"
          else
            echo "No hay contenedor de MySQL en marcha (primer despliegue en este host): no hay nada que volcar."
          fi
        '''
      }
    }

    stage('Reclaim container names') {
      steps {
        sh '''
          for name in maris-rp-bot maris-rp-api maris-rp-web maris-rp-bucket; do
            cid=$(docker ps -aq -f "name=^/${name}$")
            if [ -n "$cid" ]; then
              owner=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$cid" 2>/dev/null || echo "")
              if [ "$owner" != "${COMPOSE_PROJECT_NAME}" ]; then
                echo "Eliminando contenedor ajeno/huérfano '$name' (proyecto compose: '${owner:-ninguno}')..."
                docker rm -f "$cid" || true
              fi
            fi
          done
        '''
      }
    }

    stage('Deploy') {
      steps {
        script {
          try {
            sh 'docker compose up -d --remove-orphans'
          } catch (err) {
            echo "docker compose up failed outright: ${err}"
            sh 'docker compose logs --tail=150 maris-rp-disc-bot maris-rp-api maris-rp-web || true'
            attemptRollback()
            error("Deploy command failed for ${env.GIT_SHA} — rolled back if a previous image was available.")
          }
        }
      }
    }

    stage('Health check') {
      steps {
        script {
          def status = sh(returnStatus: true, script: '''
            set +x +e

            deadline=$(( $(date +%s) + 30 ))
            attempt=0

            while :; do
              attempt=$(( attempt + 1 ))
              bot_up=$(docker inspect -f '{{.State.Running}}' maris-rp-bot 2>/dev/null || echo false)
              api_up=$(docker inspect -f '{{.State.Running}}' maris-rp-api 2>/dev/null || echo false)
              web_up=$(docker inspect -f '{{.State.Running}}' maris-rp-web 2>/dev/null || echo false)

              if [ "$bot_up" != "true" ] || [ "$api_up" != "true" ] || [ "$web_up" != "true" ]; then
                echo "Intento ${attempt}: bot running=${bot_up}, api running=${api_up}, web running=${web_up}."
                exit 2
              fi

              bot_ready=false; api_ok=false; web_ok=false
              if docker logs --tail=200 maris-rp-bot 2>&1 | grep -q 'Bot conectado como'; then bot_ready=true; fi
              if docker exec maris-rp-api wget -S -O /dev/null -T 5 http://127.0.0.1:3000/api/me 2>&1 | grep -q 'HTTP/1.[01] 401'; then api_ok=true; fi
              if docker exec maris-rp-web wget -q -O /dev/null -T 5 http://127.0.0.1:4321/ 2>/dev/null; then web_ok=true; fi

              if [ "$bot_ready" = true ] && [ "$api_ok" = true ] && [ "$web_ok" = true ]; then
                echo "Health check OK en el intento ${attempt}."
                exit 0
              fi

              if [ "$(date +%s)" -ge "$deadline" ]; then
                echo "Sin confirmar tras ${attempt} intentos: bot ready=${bot_ready}, api HTTP ok=${api_ok}, web HTTP ok=${web_ok}."
                exit 3
              fi
              sleep 2
            done
          ''')

          if (status == 2) {
            echo 'Un contenedor se ha caído tras el deploy — intentando rollback automático.'
            sh 'docker compose logs --tail=150 maris-rp-disc-bot maris-rp-api maris-rp-web || true'
            attemptRollback()
            error("Deploy de ${env.GIT_SHA} ha tumbado un contenedor tras arrancar — ver logs arriba.")
          }

          if (status == 3) {
            echo "Contenedores en marcha pero no confirmados como listos en 30s — revisa 'docker compose logs maris-rp-disc-bot maris-rp-api maris-rp-web' en el host. No se falla el build por esto."
            sh 'docker compose logs --tail=80 maris-rp-disc-bot maris-rp-api maris-rp-web || true'
          }
        }
      }
    }
  }

  post {
    always {
      sh 'docker image prune -f --filter "dangling=true" || true'
    }
    success {
      echo "maris desplegado (bot + api + web) — commit ${env.GIT_SHA}."
    }
    failure {
      echo 'Build failed, or the deploy crashed and was rolled back — see the failed stage above for details.'
    }
  }
}
