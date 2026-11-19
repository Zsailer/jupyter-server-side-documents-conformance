import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import install_ref as install  # noqa: E402


class ParseRefTest(unittest.TestCase):
    def test_a_ref_alone_is_in_the_backends_own_repository(self):
        self.assertEqual(install.parse_ref("my-branch", "o/r"), ("o/r", "my-branch"))
        self.assertEqual(install.parse_ref(" v1.2.0 ", "o/r"), ("o/r", "v1.2.0"))
        self.assertEqual(install.parse_ref("feature/x", "o/r"), ("o/r", "feature/x"))

    def test_owner_repo_at_ref_is_a_fork(self):
        self.assertEqual(install.parse_ref("me/their-fork@some-branch", "o/r"), ("me/their-fork", "some-branch"))
        self.assertEqual(install.parse_ref("me/fork@feature/x", "o/r"), ("me/fork", "feature/x"))

    def test_what_is_not_a_ref_is_refused(self):
        for bad in ["", "  ", "--upload-pack=x", "two words", "no-slash@ref", "me/fork@", "a b/c@d"]:
            with self.assertRaises(ValueError, msg=bad):
                install.parse_ref(bad, "o/r")


class PackagesTest(unittest.TestCase):
    def checkout(self, *folders):
        root = tempfile.mkdtemp()
        for folder in folders:
            os.makedirs(os.path.join(root, folder), exist_ok=True)
            Path(root, folder, "pyproject.toml").write_text("")
        return root

    def test_the_packages_of_a_repository_that_holds_several(self):
        root = self.checkout("projects/b", "projects/a")
        Path(root, "projects", "not-a-package").mkdir()
        found = install.packages_in(root, ["projects/*"])
        self.assertEqual([os.path.relpath(f, root) for f in found], ["projects/a", "projects/b"])

    def test_the_root_comes_first_when_it_is_asked_for_first_and_missing_folders_are_skipped(self):
        root = self.checkout(".", "plugins/x")
        found = install.packages_in(root, [".", "api", "plugins/*"])
        self.assertEqual([os.path.relpath(f, root) for f in found], [".", "plugins/x"])

    def test_extras_are_asked_only_of_the_package_they_are_for(self):
        root = self.checkout(".", "plugins/x")
        extras = {".": "a,b"}
        root_folder, plugin = install.packages_in(root, [".", "plugins/*"])
        self.assertEqual(install.requirement(root, root_folder, extras), f"{root_folder}[a,b]")
        self.assertEqual(install.requirement(root, plugin, extras), plugin)

    def test_every_backend_says_where_its_packages_are(self):
        for name, backend in install.BACKENDS.items():
            self.assertRegex(backend["repository"], install.REPOSITORY, name)
            self.assertTrue(backend["packages"], name)


if __name__ == "__main__":
    unittest.main()
