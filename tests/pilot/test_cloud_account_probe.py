import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import Mock, patch

path = pathlib.Path(__file__).parents[2] / 'src/pilot/cloud_account_probe.py'
spec = importlib.util.spec_from_file_location('probe', path)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class SafetyTests(unittest.TestCase):
    def test_login_waits_for_process_exit_without_capturing_browser_inherited_pipes(self):
        child = Mock()
        child.pid = 12345
        child.returncode = 0
        child.wait.return_value = 0
        child.communicate.return_value = (b'private', b'private')
        with patch.object(probe.subprocess, 'Popen', return_value=child) as create:
            result = probe.run_once('codex.exe', 'login', {}, 2)
        self.assertEqual(create.call_args.kwargs['stdout'], probe.subprocess.DEVNULL)
        self.assertEqual(create.call_args.kwargs['stderr'], probe.subprocess.DEVNULL)
        child.wait.assert_called_once_with(timeout=2)
        child.communicate.assert_not_called()
        self.assertEqual(result, (0, b'', b''))

    def test_existing_profile_files_prevent_login_and_cleanup(self):
        with tempfile.TemporaryDirectory(dir=pathlib.Path(__file__).parent) as folder:
            profile = pathlib.Path(folder)
            self.assertTrue(probe.fresh_directory(profile))
            sentinel = profile / 'existing-data.txt'
            sentinel.write_text('preserve', encoding='utf-8')
            self.assertFalse(probe.fresh_directory(profile))
            self.assertEqual(sentinel.read_text(encoding='utf-8'), 'preserve')

    def test_old_authentication_and_runtime_environment_are_not_inherited(self):
        env = probe.child_environment({'SystemRoot': r'C:\Windows', 'PATH': 'safe',
            'OPENAI_API_KEY': 'secret', 'CODEX_ACCESS_TOKEN': 'secret',
            'CODEX_THREAD_ID': 'business', 'UNLISTED_SECRET': 'secret'}, 'isolated')
        self.assertNotIn('secret', env.values())
        self.assertNotIn('CODEX_THREAD_ID', env)
        self.assertEqual(env['CODEX_HOME'], 'isolated')

    def test_official_login_and_queries_use_only_the_new_profile(self):
        args = probe.command('codex.exe', 'login')
        self.assertIn('cli_auth_credentials_store="file"', args)
        self.assertEqual(args[-1], 'login')

    def test_generation_mutation_and_arbitrary_commands_are_rejected(self):
        for action in ['exec', 'apply', 'resume', 'logout', 'daemon', 'proxy', 'turn/start']:
            with self.assertRaises(ValueError):
                probe.command('codex.exe', action)

    def test_status_can_only_query_the_designated_test(self):
        args = probe.command('codex.exe', 'status')
        self.assertEqual(args[-1], '01a186a9-a58d-76d2-bc55-215f5b4a008e')
        self.assertEqual(args[-3], 'cloud')

    def test_list_projection_discards_other_tasks_and_all_bodies(self):
        result = probe.project_list({'items': [
            {'id': 'business', 'prompt': 'secret', 'title': 'secret'},
            {'id': probe.TARGET_ID, 'title': 'PR-Test 설정', 'prompt': 'secret'}]})
        self.assertEqual(result, {'pageEntries': 2, 'targetFound': True, 'schemaRecognized': True})
        self.assertNotIn('secret', str(result))

    def test_unknown_schema_is_never_a_successful_negative_lookup(self):
        self.assertEqual(probe.project_list({'unknown': []}),
            {'pageEntries': None, 'targetFound': None, 'schemaRecognized': False})


if __name__ == '__main__':
    unittest.main()
