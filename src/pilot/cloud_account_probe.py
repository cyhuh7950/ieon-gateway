"""공식 CLI 로그인/클라우드 조회용 실증 실행기. 생성·모델·변경 명령 없음."""
import argparse
import datetime
import json
import os
import pathlib
import re
import shutil
import subprocess

TARGET_ID = '01a186a9-a58d-76d2-bc55-215f5b4a008e'
PROFILE = pathlib.Path(r'D:\tmp\ieon-cloud-p0-20261029-1720')


def child_environment(source, profile):
    allowed = {'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'USERPROFILE',
               'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP',
               'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'OS',
               'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS'}
    result = {k: v for k, v in source.items() if k.upper() in allowed}
    result.update(CODEX_HOME=str(profile), RUST_LOG='off')
    return result


def command(executable, action):
    prefix = [executable, '-c', 'cli_auth_credentials_store="file"']
    actions = {'login': ['login'],
               'list': ['cloud', 'list', '--json', '--limit', '20'],
               'status': ['cloud', 'status', TARGET_ID]}
    if action not in actions:
        raise ValueError('COMMAND_NOT_ALLOWED')
    return prefix + actions[action]


def project_list(value):
    entries = value if isinstance(value, list) else None
    if isinstance(value, dict):
        for key in ('items', 'tasks', 'data'):
            if isinstance(value.get(key), list):
                entries = value[key]
                break
    if entries is None:
        return {'pageEntries': None, 'targetFound': None, 'schemaRecognized': False}
    found = any(isinstance(e, dict) and
                (e.get('id') or e.get('task_id') or e.get('taskId')) == TARGET_ID
                for e in entries)
    return {'pageEntries': len(entries), 'targetFound': found, 'schemaRecognized': True}


def emit(event, **values):
    print(json.dumps({'event': event, **values}, ensure_ascii=True), flush=True)


def fresh_directory(profile):
    return (profile.is_dir() and not profile.is_symlink() and not profile.is_junction()
            and not any(profile.iterdir()))


def run_once(executable, action, env, timeout):
    login = action == 'login'
    child = subprocess.Popen(command(executable, action), env=env,
                             stdin=subprocess.DEVNULL,
                             stdout=subprocess.DEVNULL if login else subprocess.PIPE,
                             stderr=subprocess.DEVNULL if login else subprocess.PIPE, shell=False,
                             creationflags=subprocess.CREATE_NO_WINDOW)
    emit('PROCESS_STARTED', action=action, pid=child.pid)
    try:
        if login:
            return child.wait(timeout=timeout), b'', b''
        stdout, stderr = child.communicate(timeout=timeout)
        return child.returncode, stdout, stderr
    except subprocess.TimeoutExpired:
        # 현재 실행기가 만든 자식만 종료. 다른 Desktop/세션은 조작하지 않는다.
        child.terminate()
        if login:
            child.wait(timeout=15)
        else:
            child.communicate(timeout=15)
        raise TimeoutError('PROBE_CHILD_TIMEOUT') from None


def cleanup_profile(profile):
    # 생성 전 승인된 경로 한 개만 제거. junction/symlink가 있으면 보존·보고한다.
    expected = PROFILE.resolve()
    resolved = profile.resolve()
    if resolved != expected or resolved.parent != pathlib.Path(r'D:\tmp').resolve():
        return False
    if not profile.exists():
        return True
    if profile.is_symlink() or profile.is_junction():
        return False
    # arg0 cache 링크가 남아 전체 정리를 보류하더라도 신규 credential은 먼저 제거한다.
    credential = profile / 'auth.json'
    if credential.is_symlink() or credential.is_junction():
        return False
    credential.unlink(missing_ok=True)
    for directory, dirs, files in os.walk(profile, followlinks=False):
        for name in dirs + files:
            item = pathlib.Path(directory) / name
            if item.is_symlink() or item.is_junction():
                return False
    shutil.rmtree(profile)
    return not profile.exists()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--executable', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    profile = PROFILE
    if not fresh_directory(profile):
        raise SystemExit('FRESH_PROFILE_REQUIRED')
    env = child_environment(os.environ, profile)
    receipt = {'targetId': TARGET_ID, 'targetKind': 'cloud_user_reported',
               'startedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'authentication': 'NOT_RUN', 'cloudList': {'status': 'NOT_RUN'},
               'cloudTargetStatus': {'status': 'NOT_RUN'},
               'bodyAccess': 'NOT_RUN_NO_BODY_METHOD_IN_THIS_PROBE',
               'answerGeneration': 'NOT_RUN', 'P0Passed': False, 'P1Started': False,
               'modelTurnStarts': 0, 'retries': 0, 'originalCredentialCopied': False,
               'businessThreadRequests': 0, 'desktopAccountChanged': False,
               'cloudExecOrApplyCommands': 0, 'loginAttempts': 0}
    stage = 'login'
    try:
        emit('LOGIN_WAITING_FOR_USER',
             notice='Complete official browser login with the designated test account; no token is requested.')
        receipt['loginAttempts'] = 1
        code, stdout, stderr = run_once(args.executable, 'login', env, 900)
        receipt['loginExitCode'] = code
        if code != 0:
            receipt['authentication'] = 'FAILED'
            return
        receipt['authentication'] = 'PASS_OFFICIAL_LOGIN_PROCESS'
        receipt['accountSelection'] = 'USER_BROWSER_SELECTION_NOT_EMAIL_INSPECTED'
        emit('OFFICIAL_LOGIN_COMPLETED')
        stage = 'list'
        code, stdout, stderr = run_once(args.executable, 'list', env, 45)
        receipt['cloudList'] = {'status': 'FAILED' if code else 'PASS_REQUEST', 'exitCode': code}
        if code:
            return
        try:
            projected = project_list(json.loads(stdout))
        except (ValueError, UnicodeError):
            projected = {'pageEntries': None, 'targetFound': None, 'schemaRecognized': False}
        receipt['cloudList'].update(projected)
        emit('CLOUD_LIST_RESULT', **receipt['cloudList'])
        stage = 'status'
        code, stdout, stderr = run_once(args.executable, 'status', env, 45)
        result = {'status': 'PASS_STATUS_REQUEST' if code == 0 else 'FAILED', 'exitCode': code}
        if code:
            text = (stdout + stderr).decode('utf-8', errors='replace')
            if re.search(r'\b404\b|not.?found', text, re.I):
                result['failureClass'] = 'NOT_FOUND'
            elif re.search(r'\b401\b|\b403\b|unauthor|forbidden', text, re.I):
                result['failureClass'] = 'AUTHORIZATION_ERROR'
            elif re.search(r'invalid.{0,30}(task|id)|(task|id).{0,30}invalid', text, re.I):
                result['failureClass'] = 'CLI_IDENTIFIER_REJECTED'
            else:
                result['failureClass'] = 'UNCLASSIFIED_NO_RAW_OUTPUT_LOGGED'
        receipt['cloudTargetStatus'] = result
        emit('CLOUD_TARGET_STATUS_RESULT', **result)
    except Exception as error:
        receipt['failure'] = {'stage': stage, 'type': type(error).__name__}
        if stage == 'login':
            receipt['authentication'] = 'UNKNOWN'
    finally:
        receipt['finishedUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        try:
            receipt['temporaryProfileRemoved'] = cleanup_profile(profile)
        except OSError:
            receipt['temporaryProfileRemoved'] = False
        receipt['newCredentialFileRemoved'] = not (profile / 'auth.json').exists()
        pathlib.Path(args.output).write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n',
                                            encoding='utf-8')
        emit('PROBE_FINISHED', receipt=receipt)


if __name__ == '__main__':
    main()
