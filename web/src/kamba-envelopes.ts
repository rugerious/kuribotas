// Kamba Oculto 2026: the family's secret-friend draw, sealed. Each adult's envelope (their pair and their
// children's) is AES-GCM encrypted with a key from their own code (PBKDF2), so nothing here is readable
// without it, and the draw was made blind: nobody, the organiser included, has seen the whole list.
import type { Sealed } from "./kamba.ts";

export const KAMBA_2026: Sealed = {
  iter: 150000,
  e: [
    { s: "hO/SB2lsNaYFRBCOO/Jbaw==", i: "oAJJkZCwBcx5BWj0", c: "KoFsZudQtL5sM3t4Soq0dXAcPX/qqZh2X+JU36FyR1/zANKhP0eKM7oxQNLC6CQef7411zV2JeubeGDQ9KpzKaFQJTAFX9Reqo7mq3fq+Ogg2RGt4mkGM9U2pv9LIaAcCj8iiOXHA/aZlGbKwu2Rp7UYmRy3LWJjqnyM7dx4UfY4OIV4sFgeeRbki8NrspS2Pk5WF07L" },
    { s: "mtv01Uc9gGaxUv1CBmSIpw==", i: "g1ZJOGqOlcHFMkLN", c: "g6RcVDgjQIZcEt5yDCYzjaOGHpvg5LVhWKzMo64R+uacbW13Bm8PYTspAdvFt5eXhDc300DlngEfij3Relo2qAD5/M+PBnNUgDu4nejQssJoc2hnvyNvUsQui9dlEGDahLkPRJs6W5T9YwmuP9zgcoN/kQWuabLdGq7qX9dnTFssvK/+FcGWSV1E4ibsmGEsXIvuvs66" },
    { s: "qjWAKhPVWbsnmYqbCdVhlg==", i: "6Z7tQdlV/fxJ2+O8", c: "pq7eldfjYhXMDW7dz3PiwyaGdtEnNLVMMlqROAH9sTgRYgeHApVQAKDaLSaMMVj0CYKWYDPEjs6k5Yra4UONlvOqhjHgb1NMNJxQi9i2W83FuC5ThYrstSBNnqdlb7QwHDZugWPpa595" },
    { s: "Vl6YTZsAwZ4KNRPgUdwfTw==", i: "tJBYvixOANJCKCl7", c: "rAg5RWC3e437b09qu/RGJUDeusJAlKOPLn12A+dOoCDADRPDszucDq/l/EJQIoi7e0NKTdPHJE7Ig4HqxON9OyOGhBtX9kfViJbXq3HKQ2jINi4cDj1F5P25ZkGxvk3/lNbLc7L2ovHw2wzOBTu5VlC9ElRKcMz5i75zRxPtbL8szYN9EpJtyFh/xLrCgnbpXtw=" },
    { s: "sye6o/eRgpu3U0YkhSSHcQ==", i: "oBRUyg2KGlpBMgrn", c: "pHitpnGgrETeXXIbq2OPjFLzFhfe8hono13COBrifwCLLjX5FzsFwXLKJ9U39VL2ogtcmTVkkkohx+V0J3ivjkcND8pIBGtRVYytLRcpjsmmDyeMrEKM8qDZSB4t/6PAoCk5Z7FgbjehaCyauFJ5gy0VmjtpPEmyU1SDK0Vsfsxxarm3L6KeZ/bCA4O7Zd/vpnE=" },
    { s: "dWtznMwCpLw7JuoRKUHJEQ==", i: "dxaEvftWyE5wik3s", c: "QekSYMGDE80ymMGylNaiFPa2TTDuLyO/I4J++tqCIP9/IkdITcSCNdTa9K4JG7wC+uApyz1zu5PiXqKlZHdE0u9pD+D1uuE662HrXwcd94KUurkqXTDjF3XkW1/pWx3ds54InJaahq4hjF31RQKmRMfTUR5YqBtjlIWZ9Pq8jZq8maqXvjKOLLvYuet9f5SpRltSRQ==" },
    { s: "EvXulQZdFDjdWI7gSveLXA==", i: "CLZDVDCdBnJSFkcF", c: "MIugsbeaPbq7HmmJD8/h5EiYqSxdEvG6oO6IlJU0kMXbWu+13rJj3AWszp1y/xjaT7RmiOEqNtsgAeV+Ie7PRomHFA/uukj9k1UjCZXEgOOAcJZQsz66hcrsp1WQR2gbyvZ3GBLFLWhaWtJ5/C8KfxGdAo2w/2V3JYQ9IZk8XazLPu+yMYxNzR+lC+9GbTICxAY=" },
  ],
};
