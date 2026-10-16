"""Broker de PTY do terminal do meu-bot. Roda onde o shell roda: na máquina remota (via `ssh host python3 -c`)
ou neste Mac (/usr/bin/python3). Só biblioteca padrão; Python 3.6+.

Fala com o app por frames binários no stdin/stdout: tipo (1 byte) + tamanho (4 bytes big-endian) + payload.
  do app:  i = entrada para o shell (bytes)   r = resize "cols rows"   k = encerrar
  do broker: o = saída do shell (bytes crus)  x = o shell saiu (payload = código, em texto)
O shell é um login shell ($SHELL ou /bin/bash) em $HOME, com TERM=xterm-256color. EOF no stdin = encerrar.
"""
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

HDR = struct.Struct(">cI")
out = sys.stdout.buffer
inp = sys.stdin.buffer


def send(kind, payload):
    out.write(HDR.pack(kind, len(payload)))
    out.write(payload)
    out.flush()


def main():
    shell = os.environ.get("SHELL") or "/bin/bash"
    if not os.path.exists(shell):
        shell = "/bin/bash" if os.path.exists("/bin/bash") else "/bin/sh"
    env = dict(os.environ)
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"
    env.setdefault("LANG", "C.UTF-8")
    cmd = sys.argv[1:] or [shell, "-l"]
    pid, master = pty.fork()
    if pid == 0:
        try:
            os.chdir(os.path.expanduser("~"))
        except OSError:
            pass
        os.execvpe(cmd[0], cmd, env)
    stdin_fd = inp.fileno()
    buf = b""
    alive = True
    code = None
    try:
        while alive:
            try:
                r, _, _ = select.select([master, stdin_fd], [], [], 0.5)
            except InterruptedError:
                continue
            if master in r:
                try:
                    data = os.read(master, 65536)
                except OSError:
                    data = b""
                if data:
                    send(b"o", data)
                else:
                    alive = False
            if stdin_fd in r:
                chunk = os.read(stdin_fd, 65536)
                if not chunk:
                    break
                buf += chunk
                while len(buf) >= HDR.size:
                    kind, n = HDR.unpack_from(buf, 0)
                    if len(buf) < HDR.size + n:
                        break
                    payload = buf[HDR.size:HDR.size + n]
                    buf = buf[HDR.size + n:]
                    if kind == b"i":
                        os.write(master, payload)
                    elif kind == b"r":
                        try:
                            cols, rows = (int(x) for x in payload.decode().split())
                            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
                        except (ValueError, OSError):
                            pass
                    elif kind == b"k":
                        alive = False
            # O filho pode ter saído sem fechar o master (netos ainda abertos): confere sem bloquear.
            wpid, status = os.waitpid(pid, os.WNOHANG)
            if wpid == pid:
                code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else 128 + os.WTERMSIG(status)
                # Drena o que sobrou antes de encerrar.
                try:
                    while True:
                        r, _, _ = select.select([master], [], [], 0.05)
                        if master not in r:
                            break
                        data = os.read(master, 65536)
                        if not data:
                            break
                        send(b"o", data)
                except OSError:
                    pass
                alive = False
    finally:
        if code is None:
            try:
                os.killpg(os.getpgid(pid), signal.SIGHUP)
            except OSError:
                pass
            try:
                _, status = os.waitpid(pid, 0)
                code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else 128 + os.WTERMSIG(status)
            except OSError:
                code = 0
        try:
            send(b"x", str(code).encode())
        except OSError:
            pass


if __name__ == "__main__":
    main()
