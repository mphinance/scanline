# Scanline in a container. Build and run:
#
#   docker build -t scanline .
#   docker run --rm -p 127.0.0.1:8000:8000 scanline
#
# Then open http://127.0.0.1:8000/. Nothing to configure, no account, no key:
# the upstream data source needs no auth.
#
# The publish is deliberately loopback-scoped, matching docker-compose.yml and
# the loopback default everywhere else. A bare `-p 8000:8000` would put the
# screener on every host interface, and the API allows all CORS origins.

FROM python:3.12-slim

# Bytecode files and stdout buffering both just get in the way in a container.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Dependencies first, in their own layer, so a source edit does not reinstall
# the world. This pulls pytest too, which is what makes the verification step
# in the README (`docker run --rm scanline python -m pytest ...`) work.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . ./

# Install the project itself for the console scripts. Everything it needs is
# already satisfied by the layer above, so this resolves to a no-op reinstall.
# Not --no-deps: if pyproject.toml ever gains a dependency requirements.txt
# does not have, this catches it instead of shipping a broken image.
RUN pip install --no-cache-dir .

# A container port is a deliberate publish, so binding every interface inside
# the container is correct here. The host still decides via -p what is exposed.
ENV SCANLINE_HOST=0.0.0.0 \
    SCANLINE_PORT=8000

# Drop root. Nothing is written at runtime, so read-only ownership is fine.
RUN useradd --create-home --uid 10001 scanline
USER scanline

EXPOSE 8000

# No curl in the slim image, so check with the interpreter that is already here.
# Reads SCANLINE_PORT rather than hardcoding 8000: overriding the port used to
# leave a perfectly healthy container reporting unhealthy, which breaks
# `depends_on: condition: service_healthy` and shows red in `compose ps`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os,urllib.request,sys; p=os.environ.get('SCANLINE_PORT','8000'); sys.exit(0 if urllib.request.urlopen(f'http://127.0.0.1:{p}/api/health', timeout=4).status == 200 else 1)"

CMD ["scanline"]
