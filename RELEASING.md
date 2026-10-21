# Releasing

Releases are driven by a tag. Pushing `v1.2.3` runs `.github/workflows/release.yml`, which
builds, tests, publishes to PyPI, pushes the image to GHCR, and cuts the GitHub Release.
Nothing is published from a laptop and no token is stored anywhere.

## One-time setup

### PyPI trusted publisher

1. Sign in at https://pypi.org and open Account settings, then Publishing.
2. Under "Add a new pending publisher" (the project does not exist yet, so it must be pending),
   fill in:
   - PyPI project name: `scanline-screener`
   - Owner: `mphinance`
   - Repository name: `scanline`
   - Workflow name: `release.yml`
   - Environment name: `pypi`
3. The first successful tag push creates the project and converts the pending publisher.

### GitHub

1. Settings, Environments, New environment named `pypi`. Add required reviewers if you want a
   manual approval gate before anything goes to PyPI.
2. Settings, Actions, General, Workflow permissions: leave the default. The workflow requests
   `id-token`, `packages` and `contents` write only on the jobs that need them.
3. After the first image push, GHCR creates the package private. Open the package settings and
   set visibility to Public, or `docker run` from a stranger's machine will fail with `denied`.

## Cut a release

1. Land everything on `master` and let CI go green.
2. Set the version in `pyproject.toml`, move the `Unreleased` heading in `CHANGELOG.md` to the
   version and date, commit.
3. Dry run: Actions, Release, Run workflow. It builds, tests, and builds both image
   architectures, and publishes nothing.
4. Tag and push:

   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

   The workflow refuses a tag that does not match the `pyproject.toml` version.

## Verify

```bash
uvx scanline-screener --no-browser --port 8765      # then GET http://127.0.0.1:8765/api/health
pipx install scanline-screener
docker run --rm -p 127.0.0.1:8000:8000 ghcr.io/mphinance/scanline
```

Check the GitHub Release has the sdist and wheel attached, and that
`docker manifest inspect ghcr.io/mphinance/scanline:1.0.0` lists amd64 and arm64.

## Yank a bad release

PyPI does not allow re-uploading a version, so fix forward.

1. On PyPI, open the release, Options, Yank. Installers skip a yanked version unless it is
   pinned exactly. Never delete it.
2. Mark the GitHub Release as a pre-release or edit its notes to point at the fix.
3. Retag the image if `latest` is bad: re-run the previous good tag's workflow, or push the next
   patch version, which moves `latest`.
4. Ship `1.0.1` with the fix.
