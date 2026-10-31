"""Names and labels for release files."""

load("@rules_pkg//pkg:providers.bzl", "PackageVariablesInfo")

def _impl(ctx):
    return PackageVariablesInfo(values = {"arch": ctx.attr.arch})

package_variables = rule(
    implementation = _impl,
    doc = "Provides {arch} (amd64 or arm64) to pkg_tar's package_file_name.",
    attrs = {"arch": attr.string(mandatory = True)},
)

def image_labels(title, version):
    """OCI labels for a release image."""
    return {
        "org.opencontainers.image.licenses": "AGPL-3.0-only",
        "org.opencontainers.image.source": "https://github.com/weirhq/weir",
        "org.opencontainers.image.title": title,
        "org.opencontainers.image.version": version,
    }
