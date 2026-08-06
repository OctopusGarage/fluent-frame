# Pull Request Automation

FluentFrame uses `dev` as the integration branch. `main` remains the manually
promoted release branch.

## Automatic lanes

Dependabot pull requests are configured to target `dev`. Patch and minor npm or
GitHub Actions updates are grouped and are squash-merged automatically only
after all checks complete successfully. Major updates remain manual.

Repository-wide review and merge of bot-managed pull requests is owned by the
local `tmux-claude-bot` supervisor. Its `prReview.repositories` entry for
`OctopusGarage/fluent-frame` uses the same policy as the other managed projects:

- base and switch-back branch: `dev`;
- two independent clean review passes;
- CI/status checks green and GitHub reports the PR mergeable;
- same-repository, narrow repair only; no fork or broad refactor repair;
- squash merge, followed by local branch switch-back and synchronization;
- failure or ambiguity is reported instead of force-merging.

The bot-created lane includes PRs produced by the configured automation and
Dependabot. Ordinary human PRs are not merged by the GitHub Actions workflow;
they remain subject to normal review policy.

## Required checks

The automatic merge workflow waits for these checks before accepting a merge:

- `checks (ubuntu-latest)`;
- `checks (macos-latest)`;
- `browser e2e`;
- `verify`;
- `scan`.

The `verify` job is intentionally the aggregate CI gate. Any failed, missing, or
still-pending required check prevents the merge.

## Security boundary

The Dependabot workflow uses `pull_request_target` because it must write PR
metadata and merge the PR. It does not check out or execute code from the pull
request. Its token is limited to repository contents and pull-request writes.
