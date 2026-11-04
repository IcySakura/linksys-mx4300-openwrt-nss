#!/bin/bash
# Move the pins in upstream/ forward.
#
#   scripts/bump-upstream.sh [RELEASE]
#
# The upstream tree is built and tested by $RELEASES_REPO, whose releases
# ("$RELEASE_PREFIX<stamp>-<run>") name the tree and nss-packages commits they
# were built from. Without RELEASE, the newest such release is used:
#   - upstream/openwrt.conf gets its tree commit,
#   - upstream/feeds.conf gets its nss commit, and every other feed the commit
#     its branch was at when the release was built,
#   - upstream/third-party.conf moves each source as its FOLLOW column says
#     (a release, the commit current when a release was published, or the
#     head of a branch).
#
# Prints what changed; exits 0 with no change when everything is current.
# In GitHub Actions it also sets the outputs "changed" and "summary".
set -euo pipefail

TOP=$(cd "$(dirname "$0")/.." && pwd)
CONF=$TOP/upstream/openwrt.conf
FEEDS=$TOP/upstream/feeds.conf
THIRD=$TOP/upstream/third-party.conf
. "$CONF"

api() {
	curl -fsSL ${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} "https://api.github.com/$1"
}
json() {
	python3 -I -c "import json, sys; d = json.load(sys.stdin); print($1)"
}
# "https://github.com/OWNER/NAME.git" -> OWNER/NAME
gh_repo() {
	echo "$1" | sed -nE 's#^https://github\.com/([^/]+/[^/]+)$#\1#p' | sed 's/\.git$//'
}
# Commit of branch $2 of GitHub repository $1 at time $3 (now if empty)
branch_commit() {
	api "repos/$1/commits?sha=$2&per_page=1${3:+&until=$3}" | json 'd[0]["sha"]'
}
# Newest release of GitHub repository $1 (drafts and pre-releases left out):
# "TAG PUBLISHED_AT"
latest_release() {
	api "repos/$1/releases/latest" | json 'd["tag_name"] + " " + d["published_at"]'
}
# Commit of tag (or any ref) $2 of GitHub repository $1
ref_commit() {
	api "repos/$1/commits/$2" | json 'd["sha"]'
}

release=${1:-}
if [ -z "$release" ]; then
	release=$(api "repos/$RELEASES_REPO/releases?per_page=30" | python3 -I -c '
import json, sys
for r in json.load(sys.stdin):
    if not r["draft"] and r["tag_name"].startswith(sys.argv[1]):
        print(r["tag_name"]); break
' "$RELEASE_PREFIX")
	[ -n "$release" ] || { echo "no $RELEASE_PREFIX* release in $RELEASES_REPO" >&2; exit 1; }
fi

# The release notes carry "**Upstream**: `OWNER/NAME@SHA`" and "**NSS**: `SHA`"
eval "$(api "repos/$RELEASES_REPO/releases/tags/$release" | python3 -I -c '
import json, re, sys
d = json.load(sys.stdin)
up = re.search(r"\*\*Upstream\*\*: `([^@`]+)@([0-9a-f]{40})`", d["body"])
nss = re.search(r"\*\*NSS\*\*: `([0-9a-f]{40})`", d["body"])
if not up: sys.exit("release %s names no upstream commit" % d["tag_name"])
# the build started at the time in the tag (<prefix><YYYYmmddTHHMMSSZ>-<run>)
m = re.search(r"(\d{8}T\d{6}Z)", d["tag_name"])
t = m.group(1) if m else d["created_at"]
if m: t = "%s-%s-%sT%s:%s:%sZ" % (t[0:4], t[4:6], t[6:8], t[9:11], t[11:13], t[13:15])
print("up_repo=%s commit=%s nss=%s built=%s" % (up.group(1), up.group(2), nss.group(1) if nss else "", t))
')"
[ "$(gh_repo "$OPENWRT_URL")" = "$up_repo" ] ||
	{ echo "release $release is built from $up_repo, not $OPENWRT_URL" >&2; exit 1; }

old_conf=$(cat "$CONF")
old_feeds=$(cat "$FEEDS")
old_third=$(cat "$THIRD")
changes=()

sed -i -e "s/^OPENWRT_COMMIT=.*/OPENWRT_COMMIT=$commit/" -e "s/^OPENWRT_RELEASE=.*/OPENWRT_RELEASE=$release/" "$CONF"

# Feeds: "src-git NAME URL^COMMIT", following the branch of "# follows NAME BRANCH"
# (nss: the release's own commit)
while read -r kind name url; do
	case "$kind" in src-git) ;; *) continue ;; esac
	repo=$(gh_repo "${url%^*}")
	branch=$(sed -n "s/^# follows $name \([^ ]*\).*/\1/p" "$FEEDS")
	[ -n "$repo" ] && [ -n "$branch" ] || { echo "feed $name: no GitHub branch to follow, left alone" >&2; continue; }
	if [ "$name" = nss ] && [ -n "$nss" ]; then
		new=$nss
	else
		new=$(branch_commit "$repo" "$branch" "$built")
	fi
	sed -i "s#^src-git $name ${url%^*}^[0-9a-f]*\$#src-git $name ${url%^*}^$new#" "$FEEDS"
done < <(grep '^src-git ' "$FEEDS")

# Third-party sources: NAME URL FOLLOW COMMIT TYPE [RELEASE]. Sources that
# follow a release go first, so BRANCH@SOURCE knows when SOURCE's was published.
declare -A published
set_source() {	# NAME COMMIT [RELEASE]
	awk -v n="$1" -v c="$2" -v r="${3:-}" '
		!/^[[:space:]]*#/ && NF >= 5 && $1 == n { print $1, $2, $3, c, $5 (r != "" ? " " r : ""); next }
		{ print }' "$THIRD" > "$THIRD.new"
	mv "$THIRD.new" "$THIRD"
}
for pass in releases others; do
	while read -r name url follow old type old_tag; do
		case "$pass:$follow" in
		releases:release|others:*@*) ;;
		others:release|releases:*@*) continue ;;
		releases:*) continue ;;
		esac
		repo=$(gh_repo "$url")
		[ -n "$repo" ] || { echo "$name: not on GitHub, left alone" >&2; continue; }
		tag=
		case "$follow" in
		release)
			rel=$(latest_release "$repo") ||
				{ echo "$name: cannot look up the newest release of $repo" >&2; exit 1; }
			read -r tag when <<< "$rel"
			published[$name]=$when
			new=$(ref_commit "$repo" "$tag")
			;;
		*@*)
			ref=${follow#*@}
			[ -n "${published[$ref]:-}" ] ||
				{ echo "$name: $ref does not follow a release, left alone" >&2; continue; }
			new=$(branch_commit "$repo" "${follow%@*}" "${published[$ref]}")
			;;
		*)
			new=$(branch_commit "$repo" "$follow")
			;;
		esac
		[ "$new" = "$old" ] && [ "$tag" = "${old_tag:-}" ] && continue
		set_source "$name" "$new" "$tag"
		if [ -n "$tag" ]; then
			changes+=("$name ${old_tag:-${old:0:7}}..$tag")
		else
			changes+=("$name ${old:0:7}..${new:0:7}")
		fi
	done < <(sed -e 's/#.*//' "$THIRD" | awk 'NF >= 5')
done

if [ "$old_conf" != "$(cat "$CONF")" ]; then
	changes=("$release" "${changes[@]}")
	old_commit=$(echo "$old_conf" | sed -n 's/^OPENWRT_COMMIT=//p')
	echo "Upstream: $release ($commit)"
	echo "Tree: https://github.com/$up_repo/compare/${old_commit:0:12}...${commit:0:12}"
fi
diff <(echo "$old_feeds" | grep '^src-') <(grep '^src-' "$FEEDS") | sed -n 's/^> /Feed: /p' || true
diff <(echo "$old_third" | grep -v '^#') <(grep -v '^#' "$THIRD") | sed -n 's/^> /Third-party: /p' || true

changed=false
if [ "$old_conf" != "$(cat "$CONF")" ] || [ "$old_feeds" != "$(cat "$FEEDS")" ] || [ "$old_third" != "$(cat "$THIRD")" ]; then
	changed=true
	[ ${#changes[@]} -gt 0 ] || changes=("feeds of $release")
else
	echo "Already current ($release)"
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
	echo "changed=$changed" >> "$GITHUB_OUTPUT"
	(IFS=,; echo "summary=${changes[*]}") | sed 's/,/, /g' >> "$GITHUB_OUTPUT"
fi
