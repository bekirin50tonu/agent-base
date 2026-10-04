---
title: "USER replaces group membership and can silently mean root"
rule_id: "RULE-DOCKER-005"
category: "security"
scope: "infrastructure"
applies_to: "Dockerfile, USER, non-root hardening, group membership, root group"
last_updated: "2026-10-04"
source: "https://docs.docker.com/reference/dockerfile.md"
---

# USER replaces group membership and can silently mean root

`USER` is the standard non-root hardening instruction, and it has two behaviours the
documentation presents as notes rather than as rules:

> The `USER` instruction sets the user name (or UID) and optionally the user
> group (or GID) to use as the default user and group for the remainder of the
> current stage.
> ([Dockerfile reference](https://docs.docker.com/reference/dockerfile.md))

Naming a group **replaces** the membership set rather than adding to it:

> Note that when specifying a group for the user, the user will have _only_ the
> specified group membership. Any other configured group memberships will be ignored.
> ([Dockerfile reference](https://docs.docker.com/reference/dockerfile.md))

And the case that defeats the hardening:

> When the user doesn't have a primary group then the image (or the next
> instructions) will be run with the `root` group.
> ([Dockerfile reference](https://docs.docker.com/reference/dockerfile.md))

## Why

The membership replacement bites in the middle of an otherwise good image. A user that belonged
to three groups loses the other two the moment you write `USER app:app`. If the entrypoint
needed group `docker` to reach the socket, or group `users` to read a mounted config, it now
gets a permission error at a point where nothing about the shape of the Dockerfile changed —
the diff is one line, and the line looks like hardening.

The root-group case is worse, because the checks that would catch it pass. `USER 1000` with no
group, on a user with no primary group in `/etc/passwd`, runs as **gid 0**. The process is not
uid 0, so:

- a policy that greps the Dockerfile for `USER root` passes;
- a scanner that flags "runs as root" looks at uid, sees 1000, passes;
- an audit that lists container users sees a non-zero uid.

Meanwhile the process holds group-root privileges for every group-readable file on the
filesystem, which in most images is a great deal. The hardening worked, and the check that was
supposed to confirm it cannot see the difference.

## Do

- Create the user and group explicitly in the image, then set both ids:
  `USER 1000:1000`.
- Put `USER` in the final stage, after any `COPY --from` that needs root to read its source.
- Confirm the id pair resolves: `id` inside the built image should print both.
- Give the process only the groups it needs, and add them deliberately — because the
  instruction replaces rather than appends.
- Scan for the numeric case specifically: `USER <uid>` with no `:` is the shape to reject.

```dockerfile
# Correct — the user exists in the image, and both ids are explicit
RUN groupadd --gid 1000 app \
 && useradd --uid 1000 --gid 1000 --no-create-home --shell /usr/sbin/nologin app
USER 1000:1000
```

## Don't

- Don't write `USER 1000` without the gid. That is the group-root case.
- Don't assume `USER app:app` adds to the existing membership. It replaces it.
- Don't use `USER` before a `COPY --from` that reads root-only paths — the copy fails, and the
  usual "fix" is to move `USER` later and forget the check that motivated it.
- Don't rely on the image's pre-existing `app` user without checking its uid, gid, and
  supplementary groups.
- Don't accept "non-root" as verified because uid is non-zero. Verify the gid.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Process has gid 0 | `USER <uid>` with no group | `USER uid:gid` |
| Entrypoint permission denied | Group membership replaced, not extended | Add the group explicitly |
| Fails only after a `USER` line | Membership replacement on a user with groups | Re-add required groups |
| Scanner says non-root, runtime disagrees | Scanner checks uid only | Check gid |
| `COPY --from` fails after `USER` | Copy needs privileges to read the source | Move `USER` after the copy |
| Works as one uid, breaks as another | Image user differs from expected | Declare the user in-image |

## Verifying

```bash
# Every USER instruction — flag any without a gid
grep -rn --include='Dockerfile*' -E '^\s*USER\s+' .

# USER with a uid but no gid, the group-root case
grep -rn --include='Dockerfile*' -E '^\s*USER\s+[0-9]+(\s|$)' .

# USER by name, where the account may not exist or may lack a primary group
grep -rn --include='Dockerfile*' -E '^\s*USER\s+[a-z]' .

# Where the user account is actually created
grep -rn --include='Dockerfile*' -E '(useradd|adduser|groupadd|addgroup)' .
```

The second list is the defect list. Every hit needs its image inspected: if the account has no
primary group in `/etc/passwd`, that container runs as group root.

These greps cannot resolve what the uid and gid map to inside the built image. Confirm with
`docker run --rm <image> id` — it prints the real identity, including supplementary groups,
and it is the only check that sees what the note describes.