package com.qualitzer.nativeuitest;

import android.app.Instrumentation;
import android.app.UiAutomation;
import android.os.Bundle;
import android.graphics.Rect;
import android.view.accessibility.AccessibilityNodeInfo;
import android.util.Base64;
import android.util.Xml;
import java.io.StringWriter;
import org.xmlpull.v1.XmlSerializer;

public final class DumpInstrumentation extends Instrumentation {
  private static String text(CharSequence value) { return value == null ? "" : value.toString(); }
  private static void write(XmlSerializer xml, AccessibilityNodeInfo node, int depth) throws Exception {
    if (node == null) return;
    if (depth > 100) throw new IllegalStateException("UI_DEPTH_EXCEEDED");
    Rect rect = new Rect();
    node.getBoundsInScreen(rect);
    xml.startTag("", "node");
    xml.attribute("", "text", text(node.getText()));
    xml.attribute("", "content-desc", text(node.getContentDescription()));
    xml.attribute("", "package", text(node.getPackageName()));
    xml.attribute("", "class", text(node.getClassName()));
    xml.attribute("", "clickable", String.valueOf(node.isClickable()));
    xml.attribute("", "scrollable", String.valueOf(node.isScrollable()));
    xml.attribute("", "enabled", String.valueOf(node.isEnabled()));
    xml.attribute("", "bounds", "[" + rect.left + "," + rect.top + "][" + rect.right + "," + rect.bottom + "]");
    for (int i = 0; i < node.getChildCount(); i++) write(xml, node.getChild(i), depth + 1);
    xml.endTag("", "node");
  }
  @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }
  @Override public void onStart() {
    Bundle result = new Bundle();
    try {
      UiAutomation automation = getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
      AccessibilityNodeInfo node = automation.getRootInActiveWindow();
      if (node == null) throw new IllegalStateException("NO_ACTIVE_UI_ROOT");
      StringWriter writer = new StringWriter();
      XmlSerializer xml = Xml.newSerializer();
      xml.setOutput(writer);
      xml.startDocument("UTF-8", true);
      write(xml, node, 0);
      xml.endDocument();
      result.putString("UI_XML_BASE64", Base64.encodeToString(writer.toString().getBytes("UTF-8"), Base64.NO_WRAP));
      finish(-1, result);
    } catch (Exception error) {
      result.putString("UI_ERROR", error.toString());
      finish(1, result);
    }
  }
}