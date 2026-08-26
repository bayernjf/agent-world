// Proxied `node:fs/promises` implementation. Every supported call goes
// through `globalThis.__proxyFs`, which forwards to the parent process for
// allowlist enforcement. Methods not yet proxied throw a clear error so
// plugin authors know to request them (or use __proxyFs directly).

const fs = globalThis.__proxyFs;

function notImplemented(name) {
  return () => {
    throw new Error(
      `fs.promises.${name} is not implemented in isolated workers; ` +
        `use globalThis.__proxyFs.${name} if available, or request it be added`,
    );
  };
}

// --- Supported operations (proxied to parent) ---
export const readFile = (path) => fs.read(path);
export const writeFile = (path, data) => fs.write(path, data);
export const appendFile = (path, data) => fs.appendFile(path, data);
export const readdir = (path) => fs.readdir(path);
export const stat = (path) => fs.stat(path);
export const unlink = (path) => fs.unlink(path);
export const mkdir = (path) => fs.mkdir(path);
export const rm = (path) => fs.rm(path);

// --- Not yet proxied (throw clear errors) ---
export const rename = notImplemented("rename");
export const copyFile = notImplemented("copyFile");
export const access = notImplemented("access");
export const open = notImplemented("open");
export const read = notImplemented("read");
export const write = notImplemented("write");
export const close = notImplemented("close");
export const lstat = notImplemented("lstat");
export const fstat = notImplemented("fstat");
export const realpath = notImplemented("realpath");
export const symlink = notImplemented("symlink");
export const link = notImplemented("link");
export const chmod = notImplemented("chmod");
export const chown = notImplemented("chown");
export const utimes = notImplemented("utimes");
export const watch = notImplemented("watch");
export const createReadStream = notImplemented("createReadStream");
export const createWriteStream = notImplemented("createWriteStream");

export default {
  readFile,
  writeFile,
  appendFile,
  readdir,
  stat,
  unlink,
  mkdir,
  rm,
  rename,
  copyFile,
  access,
  open,
  read,
  write,
  close,
  lstat,
  fstat,
  realpath,
  symlink,
  link,
  chmod,
  chown,
  utimes,
  watch,
  createReadStream,
  createWriteStream,
};
