/**
 * 兼容层：B 站侧的引号原来指向这里。读写器已经提到 src/core/protobuf.ts（抖音也用），
 * 这里只做转出，免得改一堆 import。
 */

export {
  pbBool,
  pbChild,
  pbChildren,
  pbId,
  pbNumber,
  pbString,
  pbWrite,
  pbWriteBytes,
  pbWriteVarint,
  readPb,
  type PbMessage,
} from '../../protobuf';
