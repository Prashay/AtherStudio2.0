#!/usr/bin/env python3
"""Run a shell inside a real pseudo-terminal and relay it over stdio.

stdin  -> keystrokes for the shell
stdout <- everything the terminal prints (ANSI included)
fd 3   -> JSON lines with control messages, e.g. {"cols": 120, "rows": 30}
"""
import errno
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios


def main():
    argv = sys.argv[1:] or [os.environ.get('SHELL', '/bin/bash')]
    cols = int(os.environ.get('COLUMNS', '120'))
    rows = int(os.environ.get('LINES', '30'))

    pid, fd = pty.fork()
    if pid == 0:
        os.execvp(argv[0], argv)

    def set_size(r, c):
        try:
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', max(1, r), max(1, c), 0, 0))
            os.kill(pid, signal.SIGWINCH)
        except OSError:
            pass

    set_size(rows, cols)

    def write_all(target, data):
        while data:
            try:
                n = os.write(target, data)
                data = data[n:]
            except OSError as err:
                if err.errno == errno.EAGAIN:
                    select.select([], [target], [])
                    continue
                raise

    watch = [fd, 0]
    try:
        os.fstat(3)
        watch.append(3)
    except OSError:
        pass
    control = b''

    while True:
        try:
            ready, _, _ = select.select(watch, [], [])
        except InterruptedError:
            continue
        if fd in ready:
            try:
                data = os.read(fd, 65536)
            except OSError:
                break
            if not data:
                break
            write_all(1, data)
        if 0 in ready:
            data = os.read(0, 65536)
            if not data:
                os.kill(pid, signal.SIGHUP)
                break
            write_all(fd, data)
        if 3 in ready:
            data = os.read(3, 4096)
            if not data:
                watch.remove(3)
            else:
                control += data
                while b'\n' in control:
                    line, control = control.split(b'\n', 1)
                    try:
                        msg = json.loads(line)
                        set_size(int(msg['rows']), int(msg['cols']))
                    except (ValueError, KeyError, TypeError):
                        pass

    try:
        _, status = os.waitpid(pid, 0)
        code = os.waitstatus_to_exitcode(status) if hasattr(os, 'waitstatus_to_exitcode') else 0
    except ChildProcessError:
        code = 0
    sys.exit(code if code >= 0 else 128 - code)


if __name__ == '__main__':
    main()
