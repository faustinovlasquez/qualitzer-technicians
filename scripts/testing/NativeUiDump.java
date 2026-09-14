import android.app.UiAutomation;
import android.os.HandlerThread;
import android.os.Looper;
import android.graphics.Rect;
import android.view.accessibility.AccessibilityNodeInfo;
import android.util.Xml;
import java.io.StringWriter;
import org.xmlpull.v1.XmlSerializer;

public final class NativeUiDump {
  private static String text(CharSequence value) { return value == null ? "" : value.toString(); }
  private static void write(XmlSerializer xml, AccessibilityNodeInfo node) throws Exception {
    if (node == null) return;
    Rect rect = new Rect();
    node.getBoundsInScreen(rect);
    xml.startTag("", "node");
    xml.attribute("", "text", text(node.getText()));
    xml.attribute("", "content-desc", text(node.getContentDescription()));
    xml.attribute("", "class", text(node.getClassName()));
    xml.attribute("", "clickable", String.valueOf(node.isClickable()));
    xml.attribute("", "scrollable", String.valueOf(node.isScrollable()));
    xml.attribute("", "enabled", String.valueOf(node.isEnabled()));
    xml.attribute("", "bounds", "[" + rect.left + "," + rect.top + "][" + rect.right + "," + rect.bottom + "]");
    for (int i = 0; i < node.getChildCount(); i++) write(xml, node.getChild(i));
    xml.endTag("", "node");
  }
  public static void main(String[] args) throws Exception {
    System.err.println("NATIVE_UI_START");
    HandlerThread thread = new HandlerThread("native-ui-dump");
    thread.start();
    Class<?> connectionInterface = Class.forName("android.app.IUiAutomationConnection");
    Object connection = Class.forName("android.app.UiAutomationConnection").getConstructor().newInstance();
    UiAutomation automation = (UiAutomation) UiAutomation.class.getConstructor(Looper.class, connectionInterface).newInstance(thread.getLooper(), connection);
    try {
      System.err.println("NATIVE_UI_CONNECT");
      UiAutomation.class.getMethod("connect", int.class).invoke(automation, 1);
      System.err.println("NATIVE_UI_CONNECTED");
      try { automation.waitForIdle(100, 1500); } catch (java.util.concurrent.TimeoutException expected) {}
      AccessibilityNodeInfo node = automation.getRootInActiveWindow();
      System.err.println("NATIVE_UI_ROOT");
      if (node == null) throw new IllegalStateException("NO_ACTIVE_UI_ROOT");
      StringWriter writer = new StringWriter();
      XmlSerializer xml = Xml.newSerializer();
      xml.setOutput(writer);
      xml.startDocument("UTF-8", true);
      write(xml, node);
      xml.endDocument();
      System.out.println(writer);
    } finally {
      UiAutomation.class.getMethod("disconnect").invoke(automation);
      thread.quitSafely();
    }
    System.exit(0);
  }
}