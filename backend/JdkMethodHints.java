import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Locale;

class JdkMethodHints {
  static Class<?> findType(String candidates) {
    for (String candidate : candidates.split(",")) {
      String name = candidate;
      while (name.startsWith("java.") || name.startsWith("javax.") || name.startsWith("jdk.")) {
        try {
          Class<?> type = Class.forName(name, false, ClassLoader.getPlatformClassLoader());
          Module module = type.getModule();
          if (module.isNamed() && module.isExported(type.getPackageName()) &&
              Modifier.isPublic(type.getModifiers())) return type;
          break;
        } catch (ClassNotFoundException ignored) {
          int dot = name.lastIndexOf('.');
          if (dot < 0) break;
          name = name.substring(0, dot) + "$" + name.substring(dot + 1);
        }
      }
    }
    return null;
  }

  static int distance(String left, String right) {
    left = left.toLowerCase(Locale.ROOT);
    right = right.toLowerCase(Locale.ROOT);
    int[][] costs = new int[left.length() + 1][right.length() + 1];
    for (int i = 0; i <= left.length(); i++) costs[i][0] = i;
    for (int j = 0; j <= right.length(); j++) costs[0][j] = j;
    for (int i = 1; i <= left.length(); i++) {
      for (int j = 1; j <= right.length(); j++) {
        int replace = left.charAt(i - 1) == right.charAt(j - 1) ? 0 : 1;
        costs[i][j] = Math.min(costs[i - 1][j - 1] + replace, 1 + Math.min(costs[i - 1][j], costs[i][j - 1]));
        if (i > 1 && j > 1 && left.charAt(i - 1) == right.charAt(j - 2) &&
            left.charAt(i - 2) == right.charAt(j - 1)) {
          costs[i][j] = Math.min(costs[i][j], costs[i - 2][j - 2] + 1);
        }
      }
    }
    return costs[left.length()][right.length()];
  }

  public static void main(String[] args) {
    for (int i = 0; i < args.length; i += 5) {
      String index = args[i];
      Class<?> type = findType(args[i + 1]);
      if (type == null) continue;
      String misspelled = args[i + 2];
      int arity = Integer.parseInt(args[i + 3]);
      boolean staticOnly = Boolean.parseBoolean(args[i + 4]);
      var used = new HashSet<String>();
      Arrays.stream(type.getMethods())
          .filter(method -> !method.isSynthetic() && (!staticOnly || Modifier.isStatic(method.getModifiers())))
          .filter(method -> method.getParameterCount() == arity ||
              method.isVarArgs() && arity >= method.getParameterCount() - 1)
          .filter(method -> !method.getName().equals(misspelled) &&
              distance(misspelled, method.getName()) <= (misspelled.length() < 6 ? 1 : 2))
          .sorted(Comparator.comparingInt((Method method) -> distance(misspelled, method.getName()))
              .thenComparing(Method::getName).thenComparing(Method::toGenericString))
          .filter(method -> used.add(method.getName()))
          .limit(4)
          .forEach(method -> {
            Class<?> declaring = method.getDeclaringClass();
            String signature = method.toGenericString();
            String docPath = Runtime.version().feature() + "/docs/api/" + declaring.getModule().getName() + "/" +
                declaring.getPackageName().replace('.', '/') + "/" +
                declaring.getCanonicalName().substring(declaring.getPackageName().length() + 1) + ".html";
            System.out.println(index + "\t" + method.getName() + "\t" + signature + "\t" + docPath);
          });
    }
  }
}
