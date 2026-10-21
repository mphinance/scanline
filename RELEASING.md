# Releasing

Releases are driven by a tag. Pushing `v1.2.3` runs `.github/workflows/release.yml`, which
builds, tests, builds the one-file binaries, pushes the image to GHCR, and cuts the GitHub
Release with the binaries (and sdist and wheel) attached. PyPI is optional and off by default.
Nothing is published from a laptop and no token is stored anywhere.

## How the binaries are built

The `binaries` job runs on windows-latest, macos-latest and ubuntu-latest. Each runs
`pyinstaller packaging/scanline.spec`, renames the result to `scanline-windows.exe`,
`scanline-macos` or `scanline-linux`, smoke-tests it with `python packaging/smoke.py <file>`
(start with `--no-browser`, poll `/api/health`, GET `/` and `/api/presets`, kill), and uploads
it. The `github-release` job needs all three plus the image, and attaches them. A manual
`workflow_dispatch` run builds and smoke-tests them but releases nothing.

Entry point is `packaging/scanline_app.py`; the spec bundles `frontend/` as `scanline/static`,
`scanline/fields_all.json` and the dynamic imports of uvicorn and fastmcp. If a release build
fails with a missing module or data file, add it to the spec. To build locally:
`pip install -r requirements.txt pyinstaller && pyinstaller packaging/scanline.spec`
(output in `dist/`). The binaries are unsigned, so Windows SmartScreen and macOS Gatekeeper
warn once; the README tells users how to get past that.

## One-time setup

### GitHub

1. Settings, Actions, General, Workflow permissions: leave the default. The workflow requests
   `id-token`, `packages` and `contents` write only on the jobs that need them.
2. After the first image push, GHCR creates the package private. Open the package settings and
   set visibility to Public, or `docker run` from a stranger's machine will fail with `denied`.

That is all a tag needs. PyPI below is optional.

### PyPI (optional, off by default)

The `publish-pypi` job is skipped unless the repository variable `PUBLISH_PYPI` is `true`.
To turn it on later, do the trusted-publisher steps below, create the `pypi` environment, then
set the variable under Settings, Secrets and variables, Actions, Variables. The GitHub Release
does not wait on this job either way.

1. Sign in at https://pypi.org and open Account settings, then Publishing.
2. Under "Add a new pending publisher" (the project does not exist yet, so it must be pending),
   fill in:
   - PyPI project name: `scanline-screener`
   - Owner: `mphinance`
   - Repository name: `scanline`
   - Workflow name: `release.yml`
   - Environment name: `pypi`
3. The first successful tag push creates the project and converts the pending publisher.

### GitHub environment for PyPI

Settings, Environments, New environment named `pypi`. Add required reviewers if you want a
manual approval gate before anything goes to PyPI.

## Cut a release

1. Land everything on `master` and let CI go green.
2. Set the version in `pyproject.toml`, move the `Unreleased` heading in `CHANGELOG.md` to the
   version and date, commit.
3. Dry run: Actions, Release, Run workflow. It builds, tests, builds and smoke-tests all three
   binaries and both image architectures, and publishes nothing.
4. Tag and push:

   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

   The workflow refuses a tag that does not match the `pyproject.toml` version.

## Verify

Download each binary from the Release and run it (Windows: expect the SmartScreen prompt).
Then:

```bash
docker run --rm -p 127.0.0.1:8000:8000 ghcr.io/mphinance/scanline
pipx install git+https://github.com/mphinance/scanline
# only if PUBLISH_PYPI is on:
uvx scanline-screener --no-browser --port 8765      # then GET http://127.0.0.1:8765/api/health
```

Check the GitHub Release has the three binaries (plus sdist and wheel), and that
`docker manifest inspect ghcr.io/mphinance/scanline:1.0.0` lists amd64 and arm64.

## Yank a bad release

For a bad binary, delete the asset or mark the Release pre-release and ship the next patch.
If PyPI is enabled: PyPI does not allow re-uploading a version, so fix forward.

1. On PyPI, open the release, Options, Yank. Installers skip a yanked version unless it is
   pinned exactly. Never delete it.
2. Mark the GitHub Release as a pre-release or edit its notes to point at the fix.
3. Retag the image if `latest` is bad: re-run the previous good tag's workflow, or push the next
   patch version, which moves `latest`.
4. Ship `1.0.1` with the fix.
