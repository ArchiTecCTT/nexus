// Filtre seccomp en BPF classique, chargé par `bwrap --seccomp <fd>` (comble le risque résiduel n°1 de l'ADR-001).
// Liste de refus ciblée (EPERM) des appels système qui permettent de s'évader ou d'attaquer le noyau :
// création/entrée de namespaces, montages, chargement de modules, keyring, BPF, ptrace, perf, userfaultfd…
// Architecture x86_64 uniquement ; toute autre architecture (y compris l'ABI x32) est tuée.

const AUDIT_ARCH_X86_64 = 0xc000003e;
const X32_SYSCALL_BIT = 0x40000000;

const SECCOMP_RET_KILL_PROCESS = 0x80000000;
const SECCOMP_RET_ERRNO = 0x00050000;
const SECCOMP_RET_ALLOW = 0x7fff0000;
const EPERM = 1;
const ENOSYS = 38;

// Opcodes BPF (linux/bpf_common.h)
const BPF_LD_W_ABS = 0x20; // BPF_LD | BPF_W | BPF_ABS
const BPF_JMP_JEQ_K = 0x15;
const BPF_JMP_JGE_K = 0x35;
const BPF_JMP_JSET_K = 0x45;
const BPF_RET_K = 0x06;

/** Offsets dans `struct seccomp_data` : nr (0), arch (4), args[0] (16, mot de poids faible en little-endian). */
const OFF_NR = 0;
const OFF_ARCH = 4;
const OFF_ARG0_LO = 16;

/** Numéros x86_64 refusés (EPERM). */
export const DENIED_SYSCALLS_X86_64: Readonly<Record<string, number>> = {
  ptrace: 101,
  pivot_root: 155,
  acct: 163,
  mount: 165,
  umount2: 166,
  swapon: 167,
  swapoff: 168,
  reboot: 169,
  sethostname: 170,
  setdomainname: 171,
  iopl: 172,
  ioperm: 173,
  init_module: 175,
  delete_module: 176,
  quotactl: 179,
  lookup_dcookie: 212,
  kexec_load: 246,
  add_key: 248,
  request_key: 249,
  keyctl: 250,
  unshare: 272,
  perf_event_open: 298,
  name_to_handle_at: 303,
  open_by_handle_at: 304,
  setns: 308,
  process_vm_readv: 310,
  process_vm_writev: 311,
  finit_module: 313,
  kexec_file_load: 320,
  bpf: 321,
  userfaultfd: 323,
  fsopen: 430,
  fsconfig: 431,
  fsmount: 432,
  fspick: 433,
  open_tree: 428,
  move_mount: 429,
};

const SYS_CLONE = 56;
const SYS_CLONE3 = 435;
/** Drapeaux de clone créant un namespace (CLONE_NEWNS, CGROUP, UTS, IPC, USER, PID, NET). */
const CLONE_NAMESPACE_FLAGS = 0x00020000 | 0x02000000 | 0x04000000 | 0x08000000 | 0x10000000 | 0x20000000 | 0x40000000;

type Insn = { code: number; jt: number; jf: number; k: number };
const stmt = (code: number, k: number): Insn => ({ code, jt: 0, jf: 0, k });
const jump = (code: number, k: number, jt: number, jf: number): Insn => ({ code, jt, jf, k });

export function buildSeccompProgram(): Buffer {
  const denied = Object.values(DENIED_SYSCALLS_X86_64);
  const prog: Insn[] = [
    // 1. Architecture : tout ce qui n'est pas x86_64 est tué.
    stmt(BPF_LD_W_ABS, OFF_ARCH),
    jump(BPF_JMP_JEQ_K, AUDIT_ARCH_X86_64, 1, 0),
    stmt(BPF_RET_K, SECCOMP_RET_KILL_PROCESS),
    // 2. Numéro d'appel ; l'ABI x32 (bit 30) est refusée.
    stmt(BPF_LD_W_ABS, OFF_NR),
    jump(BPF_JMP_JGE_K, X32_SYSCALL_BIT, 0, 1),
    stmt(BPF_RET_K, SECCOMP_RET_KILL_PROCESS),
  ];
  // 3. clone3 : ENOSYS (la glibc se replie sur clone, dont on peut inspecter les drapeaux).
  prog.push(jump(BPF_JMP_JEQ_K, SYS_CLONE3, 0, 1), stmt(BPF_RET_K, SECCOMP_RET_ERRNO | ENOSYS));
  // 4. clone avec un drapeau de namespace : EPERM. Sinon on recharge nr et on continue.
  prog.push(
    jump(BPF_JMP_JEQ_K, SYS_CLONE, 0, 4),
    stmt(BPF_LD_W_ABS, OFF_ARG0_LO),
    jump(BPF_JMP_JSET_K, CLONE_NAMESPACE_FLAGS, 0, 1),
    stmt(BPF_RET_K, SECCOMP_RET_ERRNO | EPERM),
    stmt(BPF_LD_W_ABS, OFF_NR),
  );
  // 5. Liste de refus : chaque entrée saute vers le retour EPERM final.
  denied.forEach((nr, i) => {
    const toDeny = denied.length - i; // nombre d'instructions jusqu'au RET EPERM
    prog.push(jump(BPF_JMP_JEQ_K, nr, toDeny, 0));
  });
  prog.push(stmt(BPF_RET_K, SECCOMP_RET_ALLOW), stmt(BPF_RET_K, SECCOMP_RET_ERRNO | EPERM));

  const buf = Buffer.alloc(prog.length * 8);
  prog.forEach((ins, i) => {
    buf.writeUInt16LE(ins.code, i * 8);
    buf.writeUInt8(ins.jt, i * 8 + 2);
    buf.writeUInt8(ins.jf, i * 8 + 3);
    buf.writeUInt32LE(ins.k >>> 0, i * 8 + 4);
  });
  return buf;
}

export function seccompSupported(arch: string = process.arch): boolean {
  return arch === "x64";
}
